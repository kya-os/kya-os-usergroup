/** Test/development adapter; production WORM/TSA/SCITT integrations implement the same port. */
export class MemorySupportingAnchorProvider {
    config;
    capability = 'supporting-anchor';
    kind;
    constructor(config) {
        this.config = config;
        this.kind = config.kind;
    }
    async publish(checkpoint) {
        return Object.freeze({
            schema: 'https://schema.kya-os.org/v1/protocol/audit/anchor-receipt/v1.0.0',
            kind: this.config.kind,
            providerId: this.config.providerId,
            checkpointDigest: checkpoint.checkpointDigest,
            issuedAt: this.config.clock.now(),
        });
    }
    async verify(checkpoint, receipt) {
        return receipt.kind === this.config.kind &&
            receipt.providerId === this.config.providerId &&
            receipt.checkpointDigest === checkpoint.checkpointDigest;
    }
}
//# sourceMappingURL=anchor.js.map