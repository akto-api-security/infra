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

			// Just proxy the connection
			const response = await fetch(request);

			// Clone headers only (no body to tee here)
			ctx.waitUntil(logTrafficWithBody(request, '', response, env, { isWebSocket: true }));

			return response;
		}

		const useGuardrails = shouldApplyGuardrails(request, env);
		console.log(`Apply guardrails on ${request.url} -> ${useGuardrails}`)

		let requestForFetch;
		let requestForLog;

		if (!useGuardrails) {
			// Normal HTTP(S) traffic
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
				logPromise.then((resBody) => logTrafficWithBody(requestForLog, resBody, response, env)).catch((e) => console.error('pipe error:', e)),
			);

			return responseForClient;
		}

		// Guardrails on: request hook only when there is a body (validate reads stream)
		let reqBodyForValidate = '';
		let reqHook = { type: 'proceed', gr: null };
		if (request.body) {
			const [reqUpstream, reqRest] = request.body.tee();
			const [reqForGuard, reqForLogStream] = reqRest.tee();
			requestForFetch = new Request(request, { body: reqUpstream });
			requestForLog = new Request(request, { body: reqForLogStream });

			if (isBlockMode(env)) {
				// Sync: await validation, block or modify before fetching upstream
				reqBodyForValidate = await readBodyAsText(new Request(request, { body: reqForGuard }));
				const beforeEntry = buildLogEntry(request, { requestPayload: reqBodyForValidate, response: null, responsePayload: '' });
				reqHook = await validateGuardrails('request', beforeEntry, env);
				if (reqHook.type === 'block') {
					return guardrailsBlockedResponse(reqHook.gr);
				}
				if (reqHook.type === 'modified') {
					requestForFetch = requestWithBody(request, String(reqHook.gr.ModifiedPayload));
					requestForLog = requestForFetch.clone();
				}
			} else {
				// Async: fire and forget, never blocks
				ctx.waitUntil(
					readBodyAsText(new Request(request, { body: reqForGuard })).then((body) => {
						const beforeEntry = buildLogEntry(request, { requestPayload: body, response: null, responsePayload: '' });
						return validateGuardrails('request', beforeEntry, env);
					}).catch((e) => console.error('guardrails request error:', e)),
				);
			}
		} else {
			requestForFetch = request;
			requestForLog = request.clone();
		}

		const requestPayloadSent = reqHook.type === 'modified' ? String(reqHook.gr.ModifiedPayload) : request.body ? reqBodyForValidate : '';

		const response = await fetch(requestForFetch);
		console.log('⬅️ Upstream response:', response.status);

		if (isBlockMode(env)) {
			// Sync mode: validate each chunk inline, block/modify/skip per chunk
			const { responseForClient, logPromise } = buildStreamingResponse(response, async (chunk, controller, decoder, encoder) => {
				const chunkText = decoder.decode(chunk, { stream: true });
				const entry = buildLogEntry(request, { requestPayload: requestPayloadSent, response, responsePayload: chunkText });
				const resHook = await validateGuardrails('response', entry, env);
				if (resHook.type === 'block') {
					console.log('🚫 Chunk blocked by guardrails, dropping');
					return;
				}
				controller.enqueue(resHook.type === 'modified' ? encoder.encode(String(resHook.gr.ModifiedPayload)) : chunk);
			});
			ctx.waitUntil(
				logPromise
					.then((resBody) => logTrafficWithBody(requestForLog, resBody, response, env))
					.catch((e) => console.error('pipe error:', e)),
			);
			return responseForClient;
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
				await logTrafficWithBody(requestForLog, resBodyForValidate, response, env);
			}).catch((e) => console.error('pipe error:', e)),
		);

		return responseForClient;
	},
};

// onChunk(chunk, controller, decoder, encoder) — optional async per-chunk hook for sync guardrails.
// If provided, it is responsible for calling controller.enqueue (or not, to drop the chunk).
// If not provided, chunks are forwarded as-is.
function buildStreamingResponse(response, onChunk = null) {
	if (!response.body) {
		return { responseForClient: response, logPromise: Promise.resolve('') };
	}
	const logChunks = [];
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const { readable, writable } = new TransformStream(
		{
			async transform(chunk, controller) {
				logChunks.push(chunk);
				if (onChunk) {
					await onChunk(chunk, controller, decoder, encoder);
				} else {
					controller.enqueue(chunk);
				}
			},
		},
		new ByteLengthQueuingStrategy({ highWaterMark: 256 * 1024 }),
		new ByteLengthQueuingStrategy({ highWaterMark: 256 * 1024 }),
	);
	const logPromise = response.body.pipeTo(writable, { preventCancel: true }).then(() => {
		const merged = new Uint8Array(logChunks.reduce((s, c) => s + c.length, 0));
		let offset = 0;
		for (const c of logChunks) { merged.set(c, offset); offset += c.length; }
		return new TextDecoder().decode(merged).slice(0, 64 * 1024);
	});
	return { responseForClient: new Response(readable, response), logPromise };
}

function isBlockMode(env) {
	return env?.AKTO_BLOCK_MODE === true || (typeof env?.AKTO_BLOCK_MODE === 'string' && env.AKTO_BLOCK_MODE.trim().toLowerCase() === 'true');
}

// logTraffic variant that accepts pre-read body strings (avoids double-reading streams)
async function logTrafficWithBody(request, resBody, response, env, opts = {}) {
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

		const aktoReq = new Request(ingestUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'Authorization': apiKey },
			body: JSON.stringify({ batchData: [logEntry] }),
		});

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
			'gen-ai': 'Gen AI'
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

/** Base URL of the Akto Data Ingestion service (no trailing slash). */
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

function guardrailsBlockedBody(gr) {
	return JSON.stringify({
		error: 'Request is blocked due to security reasons',
		reason: gr?.Reason ?? '',
	});
}

function guardrailsBlockedResponse(gr) {
	return new Response(guardrailsBlockedBody(gr), {
		status: 400,
		headers: { 'content-type': 'application/json' },
	});
}

/** Same URL/method/headers; new body string for downstream (Content-Length stripped). */
function requestWithBody(request, bodyText) {
	const headers = new Headers(request.headers);
	headers.delete('content-length');
	const init = { method: request.method, headers };
	if (!['GET', 'HEAD'].includes(request.method)) {
		init.body = bodyText;
	}
	return new Request(request.url, init);
}

function modifiedUpstreamBodyResponse(originalResponse, payload) {
	const headers = new Headers(originalResponse.headers);
	headers.delete('content-length');
	return new Response(payload, {
		status: originalResponse.status,
		statusText: originalResponse.statusText,
		headers,
	});
}
