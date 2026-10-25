import https from 'node:https';
import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';

// The server calls outside services with https.request, after looking up the host with
// dns.lookup. Replace both: every host name resolves to a public address, and each request
// is answered by `respond(request)`, which returns [status, body] or [status, body, headers].
// Undo with mock.restoreAll().
export const fakeHttps = (respond) => {
  mock.method(dns, 'lookup', (hostname, options, callback) => {
    const address = { address: '93.184.215.14', family: 4 };
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  });
  mock.method(https, 'request', (url, options, onResponse) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = (err) => { if (err) req.emit('error', err); };
    req.end = async (body) => {
      const request = { url: String(url), method: options.method, headers: options.headers, body };
      let status, reply, headers;
      try {
        [status, reply, headers = {}] = await respond(request);
      } catch (err) {
        req.emit('error', err);
        return;
      }
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = { 'content-type': 'application/json', ...headers };
      onResponse(res);
      if (reply !== undefined) res.emit('data', Buffer.from(typeof reply === 'string' ? reply : JSON.stringify(reply)));
      res.emit('end');
    };
    return req;
  });
};
