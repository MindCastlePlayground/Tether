"""Create a deployment source archive without workstation credentials."""
from pathlib import Path
import tarfile


class Package:
    @staticmethod
    def run():
        root = Path(__file__).resolve().parent.parent
        target = root / 'outputs' / 'sandbox.tar.gz'
        target.parent.mkdir(exist_ok=True)
        with tarfile.open(target, 'w:gz') as archive:
            for name in ('prototype/dist', 'prototype/node_modules', 'prototype/extension', 'prototype/package.json', 'sandbox'):
                archive.add(root / name, arcname=name, filter=Package.filter)
        print(target)

    @staticmethod
    def filter(info):
        if any(part in ('.local', '__pycache__') for part in Path(info.name).parts):
            return None
        return info


if __name__ == '__main__':
    Package.run()
