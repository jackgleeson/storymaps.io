// The app imports its own modules with site-root paths (/src/..., /vendor/...), which only a
// browser can resolve. Map them to the repo so the tests can import client modules in Node.
const ROOT = new URL('../', import.meta.url);

export const resolve = (specifier, context, next) => {
  if (specifier.startsWith('/src/')) return next(new URL('.' + specifier, ROOT).href, context);
  if (specifier.startsWith('/vendor/')) return next(new URL('./public' + specifier, ROOT).href, context);
  return next(specifier, context);
};
