import base64
import datetime
import hashlib
import ipaddress
import json
import locale
import secrets
import os
import subprocess
import sys
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from certificate import Certificate


class Setup:
    NAME = 'Tether'
    DESCRIPTION = 'Tether local browser connection'
    ROOT = Path(__file__).resolve().parents[1]
    LOCAL = ROOT / '.local'
    PORT = 18443
    LOOPBACK = '127.0.0.1'
    NO_CERTIFICATE = '--no-certificate'
    LOCAL_TRANSPORT = 'loopback'
    SUBJECT = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, NAME)])
    TEXT = {
        'en': {'exists': 'Configuration already exists.', 'created': 'Configuration created; extension ID: '},
        'zh-CN': {'exists': '配置已存在。', 'created': '配置已创建；扩展程序 ID：'},
    }

    @staticmethod
    def language():
        selected = os.environ.get('BB_LANGUAGE')
        if selected is not None:
            return selected if selected in ('en', 'zh-CN') else 'en'
        system = locale.getlocale()[0] or ''
        return 'zh-CN' if system.lower().startswith('zh') else 'en'

    @classmethod
    def create_certificate(cls, lan):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = datetime.datetime.now(datetime.timezone.utc)
        addresses = [cls.LOOPBACK]
        if lan:
            ip = ipaddress.IPv4Address(lan)
            if not any(ip in ipaddress.ip_network(n) for n in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']):
                raise ValueError('lan_address_must_be_rfc1918')
            addresses.append(lan)
        (cls.LOCAL / Certificate.KEY).write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        san = x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(a)) for a in addresses])
        Certificate.issue(cls.LOCAL, key, cls.SUBJECT, san, now)
        return base64.b64encode(hashlib.sha256(Certificate.public_key(key.public_key())).digest()).decode()

    @classmethod
    def run(cls, no_certificate=False):
        cls.LOCAL.mkdir(exist_ok=True)
        identity = subprocess.check_output(['whoami'], text=True).strip()
        subprocess.run(['icacls', str(cls.LOCAL), '/inheritance:r', '/grant:r',
                        f'{identity}:(OI)(CI)F', 'SYSTEM:(OI)(CI)F'], check=True, stdout=subprocess.DEVNULL)
        broker_file = cls.LOCAL / 'broker.json'
        cert_file = cls.LOCAL / Certificate.CERT
        key_file = cls.LOCAL / Certificate.KEY
        lan = os.environ.get('BB_LAN_IP')
        if broker_file.exists():
            broker = json.loads(broker_file.read_text(encoding='utf-8-sig'))
            if no_certificate and broker.get('transport') != cls.LOCAL_TRANSPORT:
                raise ValueError('no_certificate_requires_new_runtime')
            if (not broker.get('lan') and not lan and broker.get('keyFile') == str(key_file)
                    and broker.get('certFile') == str(cert_file) and Certificate.is_managed(cert_file, cls.SUBJECT)):
                Certificate.renew(cls.LOCAL)
                if broker.get('autoCertificate') is not True:
                    broker['autoCertificate'] = True
                    broker_file.write_text(json.dumps(broker), encoding='utf-8')
            print(cls.TEXT[cls.language()]['exists'])
            return
        if no_certificate and lan:
            raise ValueError('no_certificate_requires_loopback')
        if no_certificate:
            broker = {'transport': cls.LOCAL_TRANSPORT}
            connection = {**broker, 'url': f'ws://{cls.LOOPBACK}:{cls.PORT}/bridge'}
        else:
            pin = cls.create_certificate(lan)
            broker = {'keyFile': str(key_file), 'certFile': str(cert_file), 'autoCertificate': not bool(lan)}
            connection = {'url': f'wss://{cls.LOOPBACK}:{cls.PORT}/bridge', 'caFile': str(cert_file), 'pin': pin}
        ext_key = rsa.generate_private_key(public_exponent=65537,key_size=2048).public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        ext_id = ''.join(chr(97+int(c,16)) for c in hashlib.sha256(ext_key).hexdigest()[:32])
        (cls.LOCAL/'extension-public.json').write_text(json.dumps({'id':ext_id,'key':base64.b64encode(ext_key).decode()}),encoding='utf-8')
        ext_path = cls.ROOT/'extension'/'manifest.json'
        ext_manifest = json.loads(ext_path.read_text(encoding='utf-8'))
        ext_manifest['key'] = base64.b64encode(ext_key).decode()
        ext_path.write_text(json.dumps(ext_manifest, indent=2),encoding='utf-8')
        tokens = {name:secrets.token_urlsafe(32) for name in ['host','script','agent','intruder','python']}
        for role,token in tokens.items():
            cfg = {**connection, 'token': token}
            if role=='host': cfg['extensionId']=ext_id
            (cls.LOCAL/f'{role}.json').write_text(json.dumps(cfg),encoding='utf-8')
        broker.update(port=cls.PORT, tokens={k:hashlib.sha256(v.encode()).hexdigest() for k,v in tokens.items()})
        manifest = {'name':'com.freebird.browser_bridge','description':cls.DESCRIPTION,'path':str(cls.LOCAL/'host.exe'),'type':'stdio','allowed_origins':[f'chrome-extension://{ext_id}/']}
        (cls.LOCAL/'native-host.json').write_text(json.dumps(manifest),encoding='utf-8')
        broker_file.write_text(json.dumps(broker), encoding='utf-8')
        print(cls.TEXT[cls.language()]['created']+ext_id)


if __name__ == '__main__':
    if sys.argv[1:] == ['--renew']:
        Certificate.renew(Setup.LOCAL)
    elif sys.argv[1:] in ([], [Setup.NO_CERTIFICATE]):
        Setup.run(no_certificate=bool(sys.argv[1:]))
    else:
        raise SystemExit('Unknown setup option')
