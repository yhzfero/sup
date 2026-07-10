#!/usr/bin/env python3
"""Proxy Checker - Multi-threaded proxy validator"""

import requests
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    RESET = '\033[0m'

ASCII_ART = r'''
_._     _,-'""`-._
(,-.`._,'(       |\`-/|
    `-.-' \ )-`( , o o)
          `-    \`_`"'"-
'''

CHECK_URL = 'http://google.com'
MAX_WORKERS = 200


def check_proxy(proxy: str, timeout: float) -> bool:
    """Check if a proxy is working by making a request through it."""
    proxies = {
        'http': f'http://{proxy}',
        'https': f'https://{proxy}',
    }
    try:
        response = requests.get(CHECK_URL, proxies=proxies, timeout=timeout)
        return response.status_code == 200
    except requests.RequestException:
        return False


def main(proxy_file: str, output_file: str, timeout: float) -> None:
    with open(proxy_file, 'r') as f:
        proxies = [line.strip() for line in f if line.strip()]

    total = len(proxies)
    verified = 0
    non_verified = 0
    lock = threading.Lock()

    Path(output_file).write_text('')

    def worker(proxy: str):
        nonlocal verified, non_verified
        is_valid = check_proxy(proxy, timeout)
        with lock:
            if is_valid:
                with open(output_file, 'a') as f:
                    f.write(f'{proxy}\n')
                verified += 1
                print(f'{Colors.GREEN}Valid proxy : {proxy}{Colors.RESET}')
            else:
                non_verified += 1
                print(f'{Colors.RED}Invalid proxy : {proxy}{Colors.RESET}')

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        list(executor.map(worker, proxies))

    print(f"\nThe test of the proxies is finished. Valid proxies have been saved in {output_file}\n")
    print("Final results:\n")
    print(f"Verified proxies   : {verified} / {total}")
    print(f"Unverified proxies : {non_verified} / {total}")
    print(ASCII_ART)


if __name__ == '__main__':
    if len(sys.argv) != 5:
        print(f"Usage: python3 {sys.argv[0]} <proxy_file> <proxy_type> <output_file> <timeout>")
        print("Example: python3 checker.py proxies.txt http valides.txt 5000")
        sys.exit(1)

    main(
        proxy_file=sys.argv[1],
        output_file=sys.argv[3],
        timeout=int(sys.argv[4]) / 1000.0
    )
