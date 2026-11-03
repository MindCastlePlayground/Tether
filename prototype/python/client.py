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


class ClientError(ValueError):
    def __init__(self, code, rpc_code=None):
        super().__init__(code)
        self.code = code
        self.rpcCode = rpc_code


class Rpc:
    HTML = "html"
    NETWORK = "network"
    DIAGNOSE, WAIT, ASSERT, RECORDS = "diagnose", "wait", "assert", "records"
    BUSINESS = ("uploadStart", "uploadChunk", "uploadFinish", "uploadDrop", "downloadStart", "downloadRead", "downloadDrop", "dialog", "popupCandidates", "adoptPopup")
    METHODS = frozenset(("requestSession", "approvalStatus", "listTabs", "createTab", "closeTab", "release", HTML, "fill", "click", "navigate", "capabilities", "availableTabs", "snapshot", "locate", NETWORK, DIAGNOSE, WAIT, ASSERT, RECORDS) + BUSINESS)


class PinnedContext(ssl.SSLContext):
    def wrap_socket(self, *args, **kwargs):
        secure = super().wrap_socket(*args, **kwargs)
        try:
            from cryptography import x509
            from cryptography.hazmat.primitives import serialization
            cert = x509.load_der_x509_certificate(secure.getpeercert(binary_form=True))
            spki = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
            if base64.b64encode(hashlib.sha256(spki).digest()).decode() != self.pin:
                raise ClientError('tls_failed')
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
            raise ClientError("missingConfigPath")
        try:
            return cls(json.loads(Path(path).read_text(encoding="utf-8-sig")))
        except (OSError, ValueError):
            raise ClientError("invalidConfig") from None

    def _validate(self):
        try:
            u = urlsplit(self.config["url"])
            ip = ipaddress.ip_address(u.hostname or "")
            pin = self.config["pin"]
            decoded = base64.b64decode(pin, validate=True)
            good = str(ip) == "127.0.0.1" or ip in ipaddress.ip_network("10.0.0.0/8") or ip in ipaddress.ip_network("172.16.0.0/12") or ip in ipaddress.ip_network("192.168.0.0/16")
            if u.scheme != "wss" or u.path != "/bridge" or u.query or not isinstance(ip, ipaddress.IPv4Address) or not good or u.username or u.password or not self.config["token"] or not self.config["caFile"] or len(decoded) != 32:
                raise ClientError("invalidConfig")
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError("invalidConfig") from exc

    def open(self):
        if self.ws is not None:
            return
        try:
            ctx = PinnedContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.load_verify_locations(cafile=self.config["caFile"])
        except (OSError, ValueError):
            raise ClientError("invalidConfig") from None
        ctx.pin = self.config["pin"]
        try:
            self.ws = connect(self.config["url"], ssl=ctx, additional_headers={"Authorization": "Bearer " + self.config["token"]}, proxy=None, max_size=512*1024)
        except ClientError:
            raise
        except Exception as exc:
            raise ClientError(self._code(exc)) from None

    @staticmethod
    def _code(exc):
        status = getattr(getattr(exc, "response", None), "status_code", getattr(exc, "status_code", None))
        name = type(exc).__name__.lower()
        return "authentication_failed" if status == 403 else "broker_busy" if status == 409 else "tls_failed" if "ssl" in name or "tls" in name else "broker_unavailable" if getattr(exc, "errno", None) in (61, 111, 10061, 101, 113, 10051) else "connectionTimeout" if "timeout" in name else "connectionFailed"

    def close(self):
        if self.ws is not None:
            self.ws.close()
            self.ws = None

    def network(self, params: dict):
        return self.call(Rpc.NETWORK, params)

    def diagnose(self): return self.call(Rpc.DIAGNOSE, {})
    def html(self, params: dict): return self.call(Rpc.HTML, params)
    def wait(self, params: dict): return self.call(Rpc.WAIT, params)
    def assert_condition(self, params: dict): return self.call(Rpc.ASSERT, params)
    def records(self, op="list"): return self.call(Rpc.RECORDS, {"op": op})

    def call(self, method: str, params: dict):
        if method not in Rpc.METHODS:
            raise ClientError("unsupportedMethod")
        msg_id = str(uuid.uuid4())
        sent = False
        try:
            self.open()
            self.ws.send(json.dumps({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params}))
            sent = True
            response = json.loads(self.ws.recv(timeout=25))
        except ClientError:
            raise
        except Exception as exc:
            name = type(exc).__name__.lower()
            code = self._code(exc)
            if sent:
                code = "outcome_unknown" if "timeout" in name else "connectionClosed"
            self.close()
            raise ClientError(code) from None
        if not isinstance(response, dict) or response.get("jsonrpc") != "2.0" or response.get("id") != msg_id:
            raise ClientError("invalidResponse")
        if "error" in response:
            error = response["error"]
            raise ClientError(error.get("message", "request_failed"), error.get("code"))
        return response.get("result")
