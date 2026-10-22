import base64
import hashlib
import ipaddress
import json
import os
import ssl
import socket
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from websockets.sync.client import connect


class Rpc:
    METHODS = frozenset(("requestSession", "approvalStatus", "listTabs", "createTab", "closeTab", "release", "observe", "fill", "click", "navigate", "capabilities", "availableTabs", "snapshot", "locate"))


class PinnedContext(ssl.SSLContext):
    def wrap_socket(self, *args, **kwargs):
        secure = super().wrap_socket(*args, **kwargs)
        try:
            from cryptography import x509
            from cryptography.hazmat.primitives import serialization
            cert = x509.load_der_x509_certificate(secure.getpeercert(binary_form=True))
            spki = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
            if base64.b64encode(hashlib.sha256(spki).digest()).decode() != self.pin:
                raise ValueError('pinMismatch')
            return secure
        except Exception:
            secure.close()
            raise


class BridgeClient:
    def __init__(self, config: dict):
        self.config = config
        self._validate()
        self.ws = None

    @classmethod
    def from_env(cls):
        path = os.environ.get("BB_CLIENT_CONFIG")
        if not path:
            raise ValueError("missingConfigPath")
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def _validate(self):
        try:
            u = urlsplit(self.config["url"])
            ip = ipaddress.ip_address(u.hostname or "")
            pin = self.config["pin"]
            decoded = base64.b64decode(pin, validate=True)
            good = str(ip) == "127.0.0.1" or ip in ipaddress.ip_network("10.0.0.0/8") or ip in ipaddress.ip_network("172.16.0.0/12") or ip in ipaddress.ip_network("192.168.0.0/16")
            if u.scheme != "wss" or u.path != "/bridge" or u.query or not isinstance(ip, ipaddress.IPv4Address) or not good or u.username or u.password or not self.config["token"] or not self.config["caFile"] or len(decoded) != 32:
                raise ValueError("invalidConfig")
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("invalidConfig") from exc

    def open(self):
        if self.ws is not None:
            return
        ctx = PinnedContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.load_verify_locations(cafile=self.config["caFile"])
        ctx.pin = self.config["pin"]
        self.ws = connect(self.config["url"], ssl=ctx, additional_headers={"Authorization": "Bearer " + self.config["token"]}, proxy=None, max_size=512*1024)

    def close(self):
        if self.ws is not None:
            self.ws.close()
            self.ws = None

    def call(self, method: str, params: dict):
        if method not in Rpc.METHODS:
            raise ValueError("unsupportedMethod")
        self.open()
        msg_id = str(uuid.uuid4())
        self.ws.send(json.dumps({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params}))
        response = json.loads(self.ws.recv(timeout=25))
        if response.get("jsonrpc") != "2.0" or response.get("id") != msg_id:
            raise ValueError("invalidResponse")
        if "error" in response:
            raise ValueError("rpcFailed")
        return response.get("result")
