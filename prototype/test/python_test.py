import json
import os
import socket
import ssl
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from python.client import BridgeClient


class Paths:
    ROOT = Path(__file__).resolve().parents[1]
    LOCAL = ROOT / ".local"
    CLIENT = LOCAL / "python.json"
    BROKER = LOCAL / "broker.json"


class Ports:
    BROKER = 18443
    PIN_TRAP = 18449
    PROXY_TRAP = 18450


class ConfigKeys:
    URL = "url"
    TOKEN = "token"
    PIN = "pin"
    CA_FILE = "caFile"
    KEY_FILE = "keyFile"
    CERT_FILE = "certFile"


class TransportSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = json.loads(Paths.CLIENT.read_text(encoding="utf-8"))
        cls.broker = json.loads(Paths.BROKER.read_text(encoding="utf-8"))

    def test_two_capabilities_share_connection(self):
        client = BridgeClient(self.cfg)
        try:
            self.assertEqual(client.call("capabilities", {})["prototype"], "M0")
            first_ws = client.ws
            self.assertEqual(client.call("capabilities", {})["prototype"], "M0")
            self.assertIs(client.ws, first_ws)
        finally:
            client.close()

    def test_bad_token_is_rejected(self):
        cfg = dict(self.cfg)
        cfg[ConfigKeys.TOKEN] = "invalid-test-token"
        client = BridgeClient(cfg)
        try:
            with self.assertRaises(Exception):
                client.call("capabilities", {})
        finally:
            client.close()

    def test_external_and_dns_endpoints_are_rejected(self):
        for url in (
            "wss://8.8.8.8/bridge",
            "wss://example.com/bridge",
        ):
            cfg = dict(self.cfg)
            cfg[ConfigKeys.URL] = url
            with self.subTest(endpoint=url), self.assertRaises(ValueError):
                BridgeClient(cfg)

    def test_pin_mismatch_sends_no_http_authorization(self):
        seen = []
        ready = threading.Event()
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", Ports.PIN_TRAP))
        listener.listen(1)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.broker[ConfigKeys.CERT_FILE], self.broker[ConfigKeys.KEY_FILE])

        def serve():
            try:
                raw, _ = listener.accept()
                with context.wrap_socket(raw, server_side=True) as peer:
                    peer.settimeout(1)
                    ready.set()
                    try:
                        seen.append(peer.recv(4096))
                    except socket.timeout:
                        seen.append(b"")
            except (OSError, ssl.SSLError):
                ready.set()
            finally:
                listener.close()

        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        cfg = dict(self.cfg)
        cfg[ConfigKeys.URL] = f"wss://127.0.0.1:{Ports.PIN_TRAP}/bridge"
        cfg[ConfigKeys.PIN] = "A" * 43 + "="
        client = BridgeClient(cfg)
        try:
            with self.assertRaises(Exception):
                client.call("capabilities", {})
        finally:
            client.close()
        self.assertTrue(ready.wait(3))
        worker.join(3)
        self.assertFalse(any(seen), "HTTP bytes were sent after TLS pin failure")

    def test_proxy_environment_is_ignored(self):
        hits = []
        ready = threading.Event()
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", Ports.PROXY_TRAP))
        listener.listen(1)
        listener.settimeout(0.5)

        def serve():
            try:
                peer, _ = listener.accept()
                hits.append(True)
                peer.close()
            except socket.timeout:
                pass
            finally:
                ready.set()
                listener.close()

        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        proxy = f"http://127.0.0.1:{Ports.PROXY_TRAP}"
        with patch.dict(os.environ, {"HTTP_PROXY": proxy, "HTTPS_PROXY": proxy, "ALL_PROXY": proxy}):
            client = BridgeClient(self.cfg)
            try:
                self.assertEqual(client.call("capabilities", {})["prototype"], "M0")
            finally:
                client.close()
        self.assertTrue(ready.wait(2))
        self.assertFalse(hits)


if __name__ == "__main__":
    unittest.main()
