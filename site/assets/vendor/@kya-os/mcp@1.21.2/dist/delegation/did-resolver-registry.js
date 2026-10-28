export function buildDidResolverRegistry(entries, fetchProvider) {
    const resolvers = {};
    if (!entries) {
        return resolvers;
    }
    for (const [method, entry] of Object.entries(entries)) {
        if (!/^[a-z0-9]+$/.test(method)) {
            continue;
        }
        if (typeof entry === 'function') {
            if (fetchProvider) {
                resolvers[method] = entry(fetchProvider);
            }
            continue;
        }
        resolvers[method] = entry;
    }
    return resolvers;
}
//# sourceMappingURL=did-resolver-registry.js.map