import json, socket, time

HOST, PORT = "<IP>", 5140

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect((HOST, PORT))

def mk_payload(path, marker, size):
    return {
        "batchData": [{
            "path": path,
            "requestHeaders": "{\"x-test\":\"1\"}",
            "responseHeaders": "{\"x-test-res\":\"1\"}",
            "method": "POST",
            "requestPayload": marker + ":" + ("A" * size),
            "responsePayload": marker + ":" + ("B" * size),
            "ip": "1.2.3.4",
            "time": str(int(time.time())),
            "statusCode": "200",
            "type": "HTTP/1.1",
            "status": "OK",
            "akto_account_id": "1000000",
            "akto_vxlan_id": "0",
            "is_pending": "false",
            "source": "MIRRORING"
        }]
    }

payload1 = mk_payload("/api/A", "API_A", 9000)
payload2 = mk_payload("/api/B", "API_B", 8500)

sock.sendall(json.dumps(payload1, separators=(",",":")).encode("utf-8"))
time.sleep(0.01)

sock.sendall(json.dumps(payload2, separators=(",",":")).encode("utf-8"))
time.sleep(0.01)

sock.close()
print("sent 2 TCP payloads")
