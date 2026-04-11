const buckets = new Map();

function nowMs() {
  return Date.now();
}

function getActorKey(req) {
  const uid = req.user?.uid || req.user?.user_id || req.user?.sub;
  if (uid) return `uid:${uid}`;
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  return `ip:${ip}`;
}

function createUserScopedRateLimiter({
  windowMs,
  maxRequests,
  keyPrefix,
  message,
}) {
  return function firestoreRateLimiter(req, res, next) {
    const actorKey = getActorKey(req);
    const bucketKey = `${keyPrefix}:${actorKey}`;
    const now = nowMs();

    const existing = buckets.get(bucketKey);
    const windowStart = now - windowMs;
    const recentHits = Array.isArray(existing)
      ? existing.filter((ts) => ts > windowStart)
      : [];

    if (recentHits.length >= maxRequests) {
      const oldest = recentHits[0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: message || 'Too many requests. Please retry in a few moments.',
      });
    }

    recentHits.push(now);
    buckets.set(bucketKey, recentHits);

    return next();
  };
}

module.exports = {
  createUserScopedRateLimiter,
};
