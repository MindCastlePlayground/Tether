import base64
import datetime
import hashlib
import ipaddress
import json
import secrets
import os
import subprocess
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


class Setup:
    NAME = 'Tether'
    DESCRIPTION = 'Tether local browser connection'
    ROOT = Path(__file__).resolve().parents[1]
    LOCAL = ROOT / '.local'

    @classmethod
    def run(cls):
        cls.LOCAL.mkdir(exist_ok=True)
        identity = subprocess.check_output(['whoami'], text=True).strip()
        subprocess.run(['icacls', str(cls.LOCAL), '/inheritance:r', '/grant:r',
                        f'{identity}:(OI)(CI)F', 'SYSTEM:(OI)(CI)F'], check=True, stdout=subprocess.DEVNULL)
        if (cls.LOCAL / 'broker.json').exists():
            print('configuration_exists')
            return
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cls.NAME)])
        now = datetime.datetime.now(datetime.timezone.utc)
        addresses = ['127.0.0.1']
        lan = os.environ.get('BB_LAN_IP')
        if lan:
            ip = ipaddress.IPv4Address(lan)
            if not any(ip in ipaddress.ip_network(n) for n in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']):
                raise ValueError('lan_address_must_be_rfc1918')
            addresses.append(lan)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=5))
                .not_valid_after(now+datetime.timedelta(days=30))
                .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(a)) for a in addresses]),critical=False)
                .sign(key, hashes.SHA256()))
        (cls.LOCAL/'server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        (cls.LOCAL/'server.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        spki = key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        pin = base64.b64encode(hashlib.sha256(spki).digest()).decode()
        ext_key = rsa.generate_private_key(public_exponent=65537,key_size=2048).public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        ext_id = ''.join(chr(97+int(c,16)) for c in hashlib.sha256(ext_key).hexdigest()[:32])
        (cls.LOCAL/'extension-public.json').write_text(json.dumps({'id':ext_id,'key':base64.b64encode(ext_key).decode()}),encoding='utf-8')
        ext_path = cls.ROOT/'extension'/'manifest.json'
        ext_manifest = json.loads(ext_path.read_text(encoding='utf-8'))
        ext_manifest['key'] = base64.b64encode(ext_key).decode()
        ext_path.write_text(json.dumps(ext_manifest, indent=2),encoding='utf-8')
        tokens = {name:secrets.token_urlsafe(32) for name in ['host','script','agent','intruder','python']}
        for role,token in tokens.items():
            cfg = {'url':'wss://127.0.0.1:18443/bridge','token':token,'caFile':str(cls.LOCAL/'server.pem'),'pin':pin}
            if role=='host': cfg['extensionId']=ext_id
            (cls.LOCAL/f'{role}.json').write_text(json.dumps(cfg),encoding='utf-8')
        broker = {'port':18443,'keyFile':str(cls.LOCAL/'server.key'),'certFile':str(cls.LOCAL/'server.pem'),'tokens':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in tokens.items()}}
        (cls.LOCAL/'broker.json').write_text(json.dumps(broker),encoding='utf-8')
        manifest = {'name':'com.freebird.browser_bridge','description':cls.DESCRIPTION,'path':str(cls.LOCAL/'host.exe'),'type':'stdio','allowed_origins':[f'chrome-extension://{ext_id}/']}
        (cls.LOCAL/'native-host.json').write_text(json.dumps(manifest),encoding='utf-8')
        print('configuration_created; extension_id='+ext_id)


if __name__ == '__main__':
    Setup.run()
