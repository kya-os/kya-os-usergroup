import { AuditRecorderService, } from '../recorder-service.js';
export class LocalAuditRecorderClient {
    recorder;
    context;
    constructor(recorder, context) {
        this.recorder = recorder;
        this.context = context;
    }
    async submit(input) {
        return this.recorder.submitAuthenticated(input, await this.context());
    }
}
/** One-call composition helper for an in-process authoritative recorder. */
export function createLocalAuditRecorder(configuration, context) {
    return new LocalAuditRecorderClient(new AuditRecorderService(configuration), context);
}
//# sourceMappingURL=recorder-client.js.map