import asyncio
import json
import websockets

clients = set()

async def handler(websocket):
    clients.add(websocket)
    try:
        async for _ in websocket:
            pass
    finally:
        clients.remove(websocket)

async def broadcast(data):
    if clients:
        message = json.dumps(data)
        await asyncio.gather(
            *(client.send(message) for client in clients)
        )

async def start_server():
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()  # run forever
