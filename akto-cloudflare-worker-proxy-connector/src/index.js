export default {
	async fetch(request, env, ctx) {
		console.log('🚀 Worker handling:', request.method, request.url);

		// Detect WebSocket upgrade
		const upgradeHeader = request.headers.get('Upgrade') || '';
		const isWebSocket = upgradeHeader.toLowerCase() === 'websocket';

		if (isWebSocket) {
			console.log('🔄 WebSocket upgrade detected');

			// Just proxy the connection
			const response = await fetch(request);

			// Clone headers only (no body to tee here)
			ctx.waitUntil(logTraffic(request, '', response, env, { isWebSocket: true }));

			return response;
		}

		// Normal HTTP(S) traffic
		let requestForFetch, requestForLog;
		if (request.body) {
			const [req1, req2] = request.body.tee();
			requestForFetch = new Request(request, { body: req1 });
			requestForLog = new Request(request, { body: req2 });
		} else {
			requestForFetch = request;
			requestForLog = request.clone();
		}

		const response = await fetch(requestForFetch);
		console.log('⬅️ Upstream response:', response.status);

		const { responseForClient, logPromise } = buildStreamingResponse(response);
		ctx.waitUntil(
			logPromise.then((resBody) => logTraffic(requestForLog, resBody, response, env)).catch((e) => console.error('pipe error:', e)),
		);

		return responseForClient;
	},
};

function buildStreamingResponse(response) {
	if (!response.body) {
		return { responseForClient: response, logPromise: Promise.resolve('') };
	}
	const logChunks = [];
	const { readable, writable } = new TransformStream(
		{
			transform(chunk, controller) {
				logChunks.push(chunk);
				controller.enqueue(chunk);
			},
		},
		new ByteLengthQueuingStrategy({ highWaterMark: 1024 * 1024 }), // 1MB — don't let client backpressure stall the pipe
		new ByteLengthQueuingStrategy({ highWaterMark: 1024 * 1024 }),
	);
	const logPromise = response.body.pipeTo(writable, { preventCancel: true }).then(() => {
		const merged = new Uint8Array(logChunks.reduce((s, c) => s + c.length, 0));
		let offset = 0;
		for (const c of logChunks) {
			merged.set(c, offset);
			offset += c.length;
		}
		return new TextDecoder().decode(merged).slice(0, 64 * 1024);
	});
	return { responseForClient: new Response(readable, response), logPromise };
}

async function logTraffic(request, resBody, response, env, opts = {}) {
	try {
		console.log('📝 logTraffic running...');

		const reqContentType = request.headers.get('content-type') || '';
		const resContentType = response.headers.get('content-type') || '';
		const status = response.status;

		let reqBody = '';

		if (!opts.isWebSocket) {
			if (!(status >= 200 && status < 400)) {
				console.log('⚠️ Skipped log: status', status);
				return;
			}

			if (!reqContentType && !resContentType) {
				console.log('⚠️ Skipped log: no content-type in request or response');
				return;
			}

			if (!shouldCapture(reqContentType) && !shouldCapture(resContentType)) {
				console.log('⚠️ Skipped log: not a target content-type', { reqContentType, resContentType });
				return;
			}

			reqBody = await readBodyAsText(request);
		}

		const url = new URL(request.url);
		const logEntry = {
			path: url.pathname,
			method: request.method,
			requestHeaders: JSON.stringify(Object.fromEntries(request.headers)),
			responseHeaders: JSON.stringify(Object.fromEntries(response.headers)),
			requestPayload: reqBody,
			responsePayload: resBody,
			ip: request.headers.get('cf-connecting-ip') || '127.0.0.1',
			time: Math.floor(Date.now() / 1000).toString(),
			statusCode: status.toString(),
			type: opts.isWebSocket ? 'WebSocket' : 'HTTP/1.1',
			status: response.statusText || 'OK',
			akto_account_id: '1000000',
			akto_vxlan_id: '0',
			is_pending: 'false',
			source: 'MIRRORING',
			tag: '{\n  "service": "cloudflare"\n}',
		};

		console.log('📤 Sending log entry to webhook...');

        
        const aktoReq = new Request("https://<DATA_INGESTION_SERVICE>/api/ingestData", {
			method: 'POST',
            headers: { "content-type": "application/json", "x-api-key": "YOUR_AKTO_API_KEY" },
			body: JSON.stringify({ batchData: [logEntry] }),
		});

		// await env.<CONTAINER_BINDING_VARIABLE_NAME>.fetch(aktoReq);
		const aktoResp = await fetch(aktoReq);

		if (aktoResp.status == 200) {
			console.log('✅ Log sent to akto');
		} else {
			console.log('❌ Failed to send data to Akto. Response Status: ' + aktoResp?.status);
		}
	} catch (err) {
		console.error('❌ Log error:', err);
	}
}

function shouldCapture(contentType) {
	const targets = ['json', 'xml', 'x-www-form-urlencoded', 'soap', 'grpc', 'event-stream'];
	return targets.some((t) => contentType.toLowerCase().includes(t));
}

async function readBodyAsText(obj, maxSize = 64 * 1024) {
	try {
		const buf = await obj.arrayBuffer();
		const bytes = new Uint8Array(buf).slice(0, maxSize);
		return new TextDecoder().decode(bytes);
	} catch {
		return '';
	}
}
