import json
import ssl
import unittest
from unittest.mock import patch

from python.client import BridgeClient, ClientError


class Peer:
    def send(self, text):
        self.request = json.loads(text)

    def recv(self, timeout):
        return json.dumps({"jsonrpc": "2.0", "id": self.request["id"], "error": {"code": -32000, "message": "page_forbidden"}})

    def close(self):
        pass


class ErrorTests(unittest.TestCase):
    def client(self):
        return BridgeClient({"url": "wss://127.0.0.1:9443/bridge", "token": "test", "caFile": "missing-ca.pem", "pin": "A" * 43 + "="})

    def test_server_error_fields(self):
        client = self.client()
        client.ws = Peer()
        with self.assertRaises(ClientError) as result:
            client.call("snapshot", {})
        self.assertEqual(result.exception.code, "page_forbidden")
        self.assertEqual(result.exception.rpcCode, -32000)

    def test_config_error(self):
        with self.assertRaises(ClientError) as result:
            self.client().open()
        self.assertEqual(result.exception.code, "invalidConfig")

    def test_sent_timeout_has_unknown_outcome(self):
        client = self.client()
        client.ws = Peer()
        with patch.object(Peer, "recv", side_effect=TimeoutError), self.assertRaises(ClientError) as result:
            client.call("click", {})
        self.assertEqual(result.exception.code, "outcome_unknown")
        self.assertIsNone(client.ws)

    def test_transport_codes(self):
        self.assertEqual(BridgeClient._code(ConnectionRefusedError(10061, "private detail")), "broker_unavailable")
        self.assertEqual(BridgeClient._code(ssl.SSLError("private detail")), "tls_failed")


if __name__ == "__main__":
    unittest.main()
