// ─── Required Environment Variables ──────────────────────────────────────────
//
// AKTO_DATA_INGESTION_URL      Base URL of the Akto data ingestion service
//                              e.g. https://your-akto-instance.example.com
//
// AKTO_DATA_INGESTION_TOKEN    API token for the data ingestion service
//
// APPLY_AKTO_GUARDRAILS        Enable guardrails validation. Values: true / false / 1
//
// AKTO_GUARDRAILS_URL          Base URL of the Akto guardrails service
//                              e.g. https://your-guardrails-instance.example.com
//
// AKTO_BLOCK_MODE              Enable blocking mode. Values: true / false (default false)
//                              true  — validate each request/response chunk inline;
//                                      blocked chunks dropped, modified chunks replaced
//                              false — fire-and-forget; guardrails called for observability
//                                      only, never blocks the request
//
// AKTO_ENDPOINTS_TO_GUARD      (optional) Comma-separated path substrings to apply guardrails on.
//                              If unset, all endpoints are guarded.
//                              e.g. /api/chat,/api/completions
//
// ─────────────────────────────────────────────────────────────────────────────

export default {
	async fetch(request, env, ctx) {
		console.log('🚀 Worker handling:', request.method, request.url);

		const upgradeHeader = request.headers.get('Upgrade') || '';
		const isWebSocket = upgradeHeader.toLowerCase() === 'websocket';

		if (isWebSocket) {
			console.log('🔄 WebSocket upgrade detected');
			const response = await fetch(request);
			ctx.waitUntil(logTrafficWithBody(request, '', '', response, env, { isWebSocket: true }));
			return response;
		}

		const useGuardrails = shouldApplyGuardrails(request, env);
		console.log(`Apply guardrails on ${request.url} -> ${useGuardrails}`);

		// Read request body once; reuse bytes for upstream + validation + logging
		let reqBodyText = '';
		let requestForFetch;
		if (request.body) {
			const bodyBytes = await request.arrayBuffer();
			reqBodyText = readBytesAsText(bodyBytes);
			requestForFetch = new Request(request, { body: bodyBytes });
		} else {
			requestForFetch = request;
		}

		if (!useGuardrails) {
			const response = await fetch(requestForFetch);
			console.log('⬅️ Upstream response:', response.status);

			const { responseForClient, logPromise } = buildStreamingResponse(response);
			ctx.waitUntil(
				logPromise.then((resBody) => logTrafficWithBody(request, reqBodyText, resBody, response, env)).catch((e) => console.error('pipe error:', e)),
			);

			return responseForClient;
		}

		// Guardrails on
		let reqHook = { type: 'proceed', gr: null };
		if (request.body) {
			const beforeEntry = buildLogEntry(request, { requestPayload: reqBodyText, response: null, responsePayload: '' });

			if (isBlockMode(env)) {
				reqHook = await validateGuardrails('request', beforeEntry, env);
				if (reqHook.type === 'block') {
					return guardrailsBlockedResponse(reqHook.gr);
				}
				if (reqHook.type === 'modified') {
					reqBodyText = String(reqHook.gr.ModifiedPayload);
					requestForFetch = requestWithBody(request, reqBodyText);
				}
			} else {
				ctx.waitUntil(
					validateGuardrails('request', beforeEntry, env)
						.catch((e) => console.error('guardrails request error:', e)),
				);
			}
		}

		const requestPayloadSent = reqBodyText;

		const response = await fetch(requestForFetch);
		console.log('⬅️ Upstream response:', response.status);

		if (isBlockMode(env)) {
			// Block mode: collect full body first, validate, then send to client
			const resBody = await collectBody(response);
			const afterEntry = buildLogEntry(request, { requestPayload: requestPayloadSent, response, responsePayload: resBody });
			const resHook = await validateGuardrails('response', afterEntry, env);
			if (resHook.type === 'block') {
				return guardrailsBlockedResponse(resHook.gr);
			}
			const finalBody = resHook.type === 'modified' ? String(resHook.gr.ModifiedPayload) : resBody;
			ctx.waitUntil(logTrafficWithBody(request, requestPayloadSent, resBody, response, env));
			// Always strip content-length: body was collected/truncated (64KB max) and may be modified.
			const headers = new Headers(response.headers);
			headers.delete('content-length');
			return new Response(finalBody, { status: response.status, statusText: response.statusText, headers });
		}

		// Async mode: stream to client immediately, validate + log in background
		const { responseForClient, logPromise } = buildStreamingResponse(response);

		ctx.waitUntil(
			logPromise.then(async (resBodyForValidate) => {
				const afterEntry = buildLogEntry(request, {
					requestPayload: requestPayloadSent,
					response,
					responsePayload: resBodyForValidate,
				});
				const resHook = await validateGuardrails('response', afterEntry, env);
				if (resHook.type === 'block') {
					console.log('🚫 Response blocked by guardrails (async, logged only)');
				}
				await logTrafficWithBody(request, requestPayloadSent, resBodyForValidate, response, env);
			}).catch((e) => console.error('pipe error:', e)),
		);

		return responseForClient;
	},
};

// Drains full response body into chunks via WritableStream. Returns text string.
async function collectBody(response, maxSize = 64 * 1024) {
	if (!response.body) return '';
	const chunks = [];
	await response.body.pipeTo(new WritableStream({
		write(chunk) {
			chunks.push(chunk);
		},
	}));
	const merged = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
	let offset = 0;
	for (const c of chunks) { merged.set(c, offset); offset += c.length; }
	return readBytesAsText(merged.buffer, maxSize);
}

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
		new ByteLengthQueuingStrategy({ highWaterMark: 256 * 1024 }),
		new ByteLengthQueuingStrategy({ highWaterMark: 256 * 1024 }),
	);
	const logPromise = response.body.pipeTo(writable, { preventCancel: true }).then(() => {
		const merged = new Uint8Array(logChunks.reduce((s, c) => s + c.length, 0));
		let offset = 0;
		for (const c of logChunks) { merged.set(c, offset); offset += c.length; }
		return readBytesAsText(merged.buffer);
	});
	return { responseForClient: new Response(readable, response), logPromise };
}

function isBlockMode(env) {
	return env?.AKTO_BLOCK_MODE === true || (typeof env?.AKTO_BLOCK_MODE === 'string' && env.AKTO_BLOCK_MODE.trim().toLowerCase() === 'true');
}

async function logTrafficWithBody(request, reqBody, resBody, response, env, opts = {}) {
	try {
		console.log('📝 logTraffic running...');

		const reqContentType = request.headers.get('content-type') || '';
		const resContentType = response.headers.get('content-type') || '';
		const status = response.status;

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
		}

		const logEntry = buildLogEntry(request, {
			requestPayload: reqBody,
			response,
			responsePayload: resBody,
			opts,
		});

		console.log('📋 Log entry:', JSON.stringify(logEntry, null, 2));
		console.log('📤 Sending log entry to webhook...');

		const ingestUrl = dataIngestionIngestUrl(env);
		const apiKey = dataIngestionApiKey(env);
		if (!ingestUrl) {
			console.warn('⚠️ AKTO_DATA_INGESTION_URL or AKTO_DATA_INGESTION_TOKEN missing; skipping ingest');
			return;
		}

		const aktoResp = await fetch(ingestUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'Authorization': apiKey },
			body: JSON.stringify({ batchData: [logEntry] }),
		});

		if (aktoResp.status == 200) {
			console.log('✅ Log sent to akto');
		} else {
			console.log('❌ Failed to send data to Akto. Response Status: ' + aktoResp?.status);
		}
	} catch (err) {
		console.error('❌ Log error:', err);
	}
}

function readBytesAsText(buf, maxSize = 64 * 1024) {
	return new TextDecoder().decode(new Uint8Array(buf).slice(0, maxSize));
}

function shouldCapture(contentType) {
	const targets = ['json', 'xml', 'x-www-form-urlencoded', 'soap', 'grpc', 'event-stream'];
	return targets.some((t) => contentType.toLowerCase().includes(t));
}

function shouldApplyGuardrails(request, env) {
	const enabled = env?.APPLY_AKTO_GUARDRAILS === true || (typeof env?.APPLY_AKTO_GUARDRAILS === 'string' && (env.APPLY_AKTO_GUARDRAILS === 'true' || env.APPLY_AKTO_GUARDRAILS === '1'));
	if (!enabled) return false;
	if (request.method === 'DELETE' || request.method === 'GET') return false;

	const raw = env?.AKTO_ENDPOINTS_TO_GUARD;
	if (typeof raw !== 'string' || raw.trim() === '') {
		return true;
	}
	const requestPath = new URL(request.url).pathname.toLowerCase();
	const guardedNeedles = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => s.replace(/^\/+/, '').toLowerCase());
	return guardedNeedles.some((needle) => requestPath.includes(needle));
}

function buildLogEntry(request, { requestPayload, response = null, responsePayload = '', opts = {} }) {
	const url = new URL(request.url);
	const hasRes = response != null;
	return {
		path: url.pathname,
		method: request.method,
		requestHeaders: JSON.stringify(Object.fromEntries(request.headers)),
		responseHeaders: hasRes ? JSON.stringify(Object.fromEntries(response.headers)) : '{}',
		requestPayload,
		responsePayload,
		ip: request.headers.get('cf-connecting-ip') || '127.0.0.1',
		time: Math.floor(Date.now() / 1000).toString(),
		statusCode: hasRes ? String(response.status) : '0',
		type: opts.isWebSocket ? 'WebSocket' : 'HTTP/1.1',
		status: hasRes ? response.statusText || 'OK' : '',
		akto_account_id: '1000000',
		akto_vxlan_id: '0',
		is_pending: 'false',
		source: 'MIRRORING',
		tag: JSON.stringify({
			service: 'cloudflare',
			'gen-ai': 'Gen AI',
		}),
	};
}

async function validateGuardrails(phase, logEntry, env) {
	const base = guardrailsServiceBaseUrl(env);
	if (!base) {
		console.warn('⚠️ AKTO_GUARDRAILS_URL is missing or empty; skipping guardrails (' + phase + ')');
		return { type: 'proceed', gr: null };
	}
	let payloadForGuardrails = { ...logEntry, contextSource: 'AGENTIC' };
	let wrappedResponsePayload = false;
	let isJson = true;
	if (phase === 'response' && typeof payloadForGuardrails.responsePayload === 'string') {
		const t = payloadForGuardrails.responsePayload.trim();
		if (t !== '') {
			try {
				JSON.parse(t);
			} catch {
				isJson = false;
			}
		}
		if (!isJson) {
			payloadForGuardrails = {
				...payloadForGuardrails,
				responsePayload: JSON.stringify({ response: payloadForGuardrails.responsePayload }),
			};
			wrappedResponsePayload = true;
		}
	}
	console.log(`calling guardrails: for phase ${phase} ->, ${JSON.stringify(payloadForGuardrails)}`);
	const url = `${base}/api/validate/${phase}`;
	let gr = { Allowed: true, Modified: false };
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payloadForGuardrails),
		});
		const text = await res.text();
		console.log(`response from guardrail for phase ${phase} -> ${text}`);
		try {
			gr = JSON.parse(text);
		} catch {
			console.log('⚠️ Guardrails non-JSON response:', res.status, text.slice(0, 200));
		}
		if (phase === 'response' && wrappedResponsePayload && gr?.Modified === true && typeof gr?.ModifiedPayload === 'string') {
			try {
				const parsed = JSON.parse(gr.ModifiedPayload);
				if (parsed && typeof parsed === 'object' && typeof parsed.response === 'string') {
					gr = { ...gr, ModifiedPayload: parsed.response };
				}
			} catch {
				// keep ModifiedPayload as-is if it's not the wrapper format
			}
		}
	} catch (e) {
		console.error('⚠️ Guardrails fetch error:', e);
	}
	if (!gr || typeof gr.Allowed !== 'boolean') {
		return { type: 'proceed', gr };
	}
	if (!gr.Allowed) {
		return { type: 'block', gr };
	}
	if (gr.Modified === true && gr.ModifiedPayload != null && String(gr.ModifiedPayload).length > 0) {
		return { type: 'modified', gr };
	}
	return { type: 'proceed', gr };
}

function guardrailsServiceBaseUrl(env) {
	const u = env?.AKTO_GUARDRAILS_URL;
	if (typeof u === 'string' && u.trim() !== '') {
		return u.trim().replace(/\/$/, '');
	}
	return null;
}

function dataIngestionIngestUrl(env) {
	const u = env?.AKTO_DATA_INGESTION_URL;
	if (typeof u !== 'string' || u.trim() === '') {
		return null;
	}
	return `${u.trim().replace(/\/$/, '')}/api/ingestData`;
}

function dataIngestionApiKey(env) {
	const k = env?.AKTO_DATA_INGESTION_TOKEN;
	if (typeof k !== 'string' || k.trim() === '') {
		return null;
	}
	return k.trim();
}

function guardrailsBlockedResponse(gr) {
	return new Response(
		JSON.stringify({ error: 'Request is blocked due to security reasons', reason: gr?.Reason ?? '' }),
		{ status: 400, headers: { 'content-type': 'application/json' } },
	);
}

function requestWithBody(request, bodyText) {
	const headers = new Headers(request.headers);
	headers.delete('content-length');
	const init = { method: request.method, headers };
	if (!['GET', 'HEAD'].includes(request.method)) {
		init.body = bodyText;
	}
	return new Request(request.url, init);
}
