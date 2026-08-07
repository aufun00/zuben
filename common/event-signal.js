const BEACON_BASE_URL = new URL("../beacon/", import.meta.url);

export function emitEventSignal({ gameID, timeS, event, beaconBaseHref = BEACON_BASE_URL, fetchFn = fetch }) {
  const url = new URL(`${gameID}.${timeS}.${event}.html`, beaconBaseHref);
  try {
    const request = fetchFn(url.href, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    });
    void Promise.resolve(request).catch(() => {});
  } catch {}
}
