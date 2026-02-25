"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeJsonStringify = safeJsonStringify;
function safeJsonStringify(v, space) {
    try {
        return JSON.stringify(v, null, space);
    }
    catch {
        return "";
    }
}
//# sourceMappingURL=json.js.map