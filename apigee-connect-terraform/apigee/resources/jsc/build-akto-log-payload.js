(function () {
  var SENSITIVE_HEADERS = {
    "authorization": true,
    "cookie": true,
    "proxy-authorization": true,
    "set-cookie": true
  };

  function safeString(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  }

  function trim(value) {
    return safeString(value).replace(/^\s+|\s+$/g, "");
  }

  function firstNonEmpty(values) {
    for (var i = 0; i < values.length; i++) {
      var candidate = trim(values[i]);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  function parseHeaderNames(raw) {
    var namesRaw = trim(raw);
    if (!namesRaw) {
      return [];
    }

    namesRaw = namesRaw.replace(/^\[/, "").replace(/\]$/, "");
    if (!namesRaw) {
      return [];
    }

    var splitNames = namesRaw.split(",");
    var result = [];
    for (var i = 0; i < splitNames.length; i++) {
      var headerName = trim(splitNames[i]);
      if (headerName) {
        result.push(headerName);
      }
    }
    return result;
  }

  function getHeaderValue(prefix, headerName) {
    var value = context.getVariable(prefix + headerName);
    if (value === null || value === undefined || value === "") {
      value = context.getVariable(prefix + headerName.toLowerCase());
    }
    return safeString(value);
  }

  function collectHeaders(prefix, namesVariable) {
    var headerNames = parseHeaderNames(context.getVariable(namesVariable));
    var headers = {};

    for (var i = 0; i < headerNames.length; i++) {
      var headerName = headerNames[i];
      var headerNameLower = headerName.toLowerCase();
      if (SENSITIVE_HEADERS[headerNameLower]) {
        continue;
      }

      var headerValue = getHeaderValue(prefix, headerName);
      if (!headerValue) {
        continue;
      }

      headers[headerName] = headerValue;
    }

    return headers;
  }

  function buildAktoPayload() {
    var requestPath = firstNonEmpty([
      context.getVariable("proxy.pathsuffix"),
      context.getVariable("request.path"),
      context.getVariable("request.uri")
    ]);
    var queryString = trim(context.getVariable("request.querystring"));
    var pathWithQuery = requestPath;
    if (queryString) {
      pathWithQuery = requestPath + "?" + queryString;
    }

    var method = firstNonEmpty([context.getVariable("request.verb")]);
    var clientIp = firstNonEmpty([
      context.getVariable("request.header.x-forwarded-for"),
      context.getVariable("request.header.x-real-ip"),
      context.getVariable("proxy.client.ip"),
      context.getVariable("client.ip")
    ]);
    if (clientIp.indexOf(",") >= 0) {
      clientIp = trim(clientIp.split(",")[0]);
    }

    var rawTimestamp = context.getVariable("system.timestamp");
    var parsedTimestamp = Number(rawTimestamp);
    if (isNaN(parsedTimestamp)) {
      parsedTimestamp = new Date().getTime();
    }
    var epochSeconds = String(Math.floor(parsedTimestamp / 1000));

    var responseStatus = firstNonEmpty([
      context.getVariable("response.status.code"),
      context.getVariable("message.status.code"),
      "0"
    ]);

    var responseReason = firstNonEmpty([
      context.getVariable("response.reason.phrase"),
      context.getVariable("message.reason.phrase"),
      context.getVariable("response.reason"),
      "UNKNOWN"
    ]);

    var requestHeadersObj = collectHeaders("request.header.", "request.headers.names");
    var responseHeadersObj = collectHeaders("response.header.", "response.headers.names");

    var batchItem = {
      path: pathWithQuery,
      requestHeaders: JSON.stringify(requestHeadersObj),
      responseHeaders: JSON.stringify(responseHeadersObj),
      method: method,
      requestPayload: safeString(context.getVariable("request.content")),
      responsePayload: safeString(context.getVariable("response.content")),
      ip: clientIp,
      time: epochSeconds,
      statusCode: responseStatus,
      type: "HTTP/1.1",
      status: responseReason,
      akto_account_id: "1000000",
      akto_vxlan_id: "0",
      is_pending: "false",
      source: "MIRRORING"
    };

    var tag = trim(context.getVariable("request.header.x-akto-tag"));
    if (tag) {
      batchItem.tag = tag;
    }

    return {
      batchData: [batchItem]
    };
  }

  try {
    context.setVariable("akto.log.payload", JSON.stringify(buildAktoPayload()));
  } catch (err) {
    context.setVariable("akto.log.payload", JSON.stringify({
      batchData: [{
        path: "",
        requestHeaders: "{}",
        responseHeaders: "{}",
        method: "",
        requestPayload: "",
        responsePayload: "",
        ip: "",
        time: String(Math.floor(new Date().getTime() / 1000)),
        statusCode: "",
        type: "HTTP/1.1",
        status: "",
        akto_account_id: "1000000",
        akto_vxlan_id: "0",
        is_pending: "false",
        source: "MIRRORING",
        truncationReason: "akto_payload_build_failed",
        error: safeString(err)
      }]
    }));
  }
})();
