// Keep the browser on the service's public origin. Keys stay in fragments/headers.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return env.SHARED_SKY.fetch(request);
    if (
      url.pathname === "/" &&
      !url.searchParams.has("shared") &&
      !url.searchParams.has("ui")
    ) {
      url.searchParams.set("shared", "1");
      return Response.redirect(url.href, 302);
    }
    return env.ASSETS.fetch(request);
  },
};
