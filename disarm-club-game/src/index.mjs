// Worker
export function send404() {
  return new Response("Not found", {status: 404})
}


export default {
  async fetch(request, env) {
    return await handleErrors(request, async () => {
      // We have received an HTTP request! Parse the URL and route the request.

      let url = new URL(request.url);
      let path = url.pathname.slice(1).split('/');

      if (!path[0]) {
        // Serve our HTML at the root path.
        return new Response('', {headers: {"Content-Type": "text/html;charset=UTF-8"}});
      }

      switch (path[0]) {
        case "api":
          // This is a request for `/api/...`, call the API handler.
          return handleApiRequest(path.slice(1), request, env);

        default:
          return send404();
      }
    });
  }
}

async function handleErrors(request, func) {
  try {
    return await func();
  } catch (err) {
    if (request.headers.get("Upgrade") == "websocket") {
      // Annoyingly, if we return an HTTP error in response to a WebSocket request, Chrome devtools
      // won't show us the response body! So... let's send a WebSocket response with an error
      // frame instead.
      let pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({error: err.stack}));
      pair[1].close(1011, "Uncaught exception during session setup");
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      return new Response(err.stack, {status: 500});
    }
  }
}

async function handleApiRequest(path, request, env) {
  switch (path[0]) {
    case "games":
      return handleGames(path.slice(1), request, env)
    default:
      return send404();
  }
}

function createShortCode(date) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

  const dayTimeInMills =
    date.getMilliseconds() +
    1000 * (date.getSeconds() + 60 * (date.getMinutes() + 60 * date.getHours()))

  const maxDayTimeInMills = 86400000 // 24 * 60 * 60 * 1000
  const maxFourDigitB26 = ALPHA.length ** 4
  const decimalFourDigitB26 =
    (dayTimeInMills / maxDayTimeInMills) * maxFourDigitB26

  const shortCode =
    ALPHA.charAt(Math.floor(decimalFourDigitB26 / (ALPHA.length ** 3)) % ALPHA.length) +
    ALPHA.charAt(Math.floor(decimalFourDigitB26 / (ALPHA.length ** 2)) % ALPHA.length) +
    ALPHA.charAt(Math.floor(decimalFourDigitB26 / ALPHA.length) % ALPHA.length) +
    ALPHA.charAt(decimalFourDigitB26 % ALPHA.length)

  return shortCode
}

async function handleGames(path, request, env) {
  if (path.length === 0) {
    if (request.method == "POST") {
      env.games.idFromName(createShortCode(new Date()))
    }
  } else {
    let shortCode = createShortCode(new Date())
    let id = env.games.idFromName(shortCode)
    let obj = env.games.get(id)
    let resp = await obj.fetch(request);
    let count = await resp.text();
    return new Response(`Durable Object '${shortCode}' count: ${count}`);
  }
}


export class DisarmClubGame {
  constructor(state, env) {
    this.state = state;
    // `blockConcurrencyWhile()` ensures no requests are delivered until
    // initialization completes.
    this.state.blockConcurrencyWhile(async () => {
        let stored = await this.state.storage.get("value");
        this.value = stored || 0;
    })
  }

  async fetch(request) {
    let currentValue = this.value;
    return new Response(currentValue);
  }
}

export class RateLimiter {
  constructor(_controller, _env) {
    this.nextAllowedTime = 0;
  }

  async fetch(request) {
    return await handleErrors(request, async () => {
      let now = Date.now();

      this.nextAllowedTime = Math.max(now, this.nextAllowedTime);

      if (request.method == "POST") {
        this.nextAllowedTime += 10;
      }

      let timeout = Math.max(0, this.nextAllowedTime - now - 20000);
      return new Response(timeout);
    })
  }
}

class RateLimiterClient {
  constructor(getLimiterStub, reportError) {
    this.getLimiterStub = getLimiterStub;
    this.reportError = reportError;

    this.limiter = getLimiterStub();
    this.isEnhancingCalm = false;
  }

  checkLimit() {
    if (this.isEnhancingCalm) {
      return false;
    }
    this.isEnhancingCalm = true;
    this.callLimiter();
    return true;
  }

  async callLimiter() {
    try {
      let response;
      try {
        response = await this.limiter.fetch("https://dev/null", {method: "POST"});
      } catch (err) {
        this.limiter = this.getLimiterStub();
        response = await this.limiter.fetch("https://dev/null", {method: "POST"});
      }

      let timeout = +(await response.text());
      await new Promise(resolve => setTimeout(resolve, timeout));

      this.isEnhancingCalm = false;
    } catch (err) {
      this.reportError(err);
    }
  }
}
