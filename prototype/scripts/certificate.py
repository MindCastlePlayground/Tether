import datetime
import ipaddress
import tempfile
from pathlib import Path

from cryptography import x509
from cryptography.exceptions import InvalidSignature, UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes, serialization


class Certificate:
    KEY = 'server.key'
    CERT = 'server.pem'
    LIFETIME = datetime.timedelta(days=30)

    @staticmethod
    def is_managed(file, subject):
        try:
            cert = x509.load_pem_x509_certificate(file.read_bytes())
            if cert.subject != subject:
                return False
            cert.verify_directly_issued_by(cert)
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        except (OSError, ValueError, TypeError, InvalidSignature, UnsupportedAlgorithm, x509.ExtensionNotFound):
            return False
        return list(san) == [x509.IPAddress(ipaddress.IPv4Address('127.0.0.1'))]

    @staticmethod
    def public_key(key):
        return key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    @classmethod
    def issue(cls, directory, key, subject, addresses, now):
        cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=5))
                .not_valid_after(now + cls.LIFETIME)
                .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                .add_extension(addresses, critical=False)
                .sign(key, hashes.SHA256()))
        target = directory / cls.CERT
        temp = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, delete=False) as file:
                temp = Path(file.name)
                file.write(cert.public_bytes(serialization.Encoding.PEM))
            temp.replace(target)
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)

    @classmethod
    def renew(cls, directory):
        cert = x509.load_pem_x509_certificate((directory / cls.CERT).read_bytes())
        now = datetime.datetime.now(datetime.timezone.utc)
        if cert.not_valid_after_utc > now:
            return
        key = serialization.load_pem_private_key((directory / cls.KEY).read_bytes(), password=None)
        cert.verify_directly_issued_by(cert)
        if cls.public_key(key.public_key()) != cls.public_key(cert.public_key()):
            raise ValueError('certificate_key_mismatch')
        addresses = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        cls.issue(directory, key, cert.subject, addresses, now)
