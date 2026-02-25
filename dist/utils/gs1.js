"use strict";
/**
 * Minimal GS1 helpers.
 * - Computes GS1 check digit (Mod-10, weights 3/1).
 * - Parses common EPC URNs: sgtin, sgln, sscc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.gs1CheckDigit = gs1CheckDigit;
exports.toGtin14 = toGtin14;
exports.toGln13 = toGln13;
exports.toSscc18 = toSscc18;
exports.parseEpcUrn = parseEpcUrn;
function gs1CheckDigit(base) {
    const digits = base.replace(/\D/g, "");
    let sum = 0;
    // right-to-left, alternating weights 3 and 1 starting with 3 on the rightmost digit
    let weight = 3;
    for (let i = digits.length - 1; i >= 0; i--) {
        const d = digits.charCodeAt(i) - 48;
        if (d < 0 || d > 9)
            throw new Error("Invalid digit");
        sum += d * weight;
        weight = weight === 3 ? 1 : 3;
    }
    const mod = sum % 10;
    return mod === 0 ? 0 : 10 - mod;
}
function toGtin14(companyPrefix, itemReference) {
    // In SGTIN, itemReference includes the indicator digit.
    const base13 = (companyPrefix + itemReference).padStart(13, "0");
    const cd = gs1CheckDigit(base13);
    return base13 + String(cd);
}
function toGln13(companyPrefix, locationReference) {
    const base12 = (companyPrefix + locationReference).padStart(12, "0");
    const cd = gs1CheckDigit(base12);
    return base12 + String(cd);
}
function toSscc18(companyPrefix, serialReference) {
    const base17 = (companyPrefix + serialReference).padStart(17, "0");
    const cd = gs1CheckDigit(base17);
    return base17 + String(cd);
}
function parseEpcUrn(epc) {
    const raw = String(epc ?? "").trim();
    const sgtin = raw.match(/^urn:epc:id:sgtin:([0-9]+)\.([0-9]+)\.([^\s]+)$/i);
    if (sgtin) {
        const companyPrefix = sgtin[1];
        const itemReference = sgtin[2];
        const serial = sgtin[3];
        const gtin14 = toGtin14(companyPrefix, itemReference);
        return { scheme: "sgtin", companyPrefix, itemReference, serial, gtin14 };
    }
    const sgln = raw.match(/^urn:epc:id:sgln:([0-9]+)\.([0-9]+)\.([^\s]+)$/i);
    if (sgln) {
        const companyPrefix = sgln[1];
        const locationReference = sgln[2];
        const extension = sgln[3];
        const gln13 = toGln13(companyPrefix, locationReference);
        return { scheme: "sgln", companyPrefix, locationReference, extension, gln13 };
    }
    const sscc = raw.match(/^urn:epc:id:sscc:([0-9]+)\.([0-9]+)$/i);
    if (sscc) {
        const companyPrefix = sscc[1];
        const serialReference = sscc[2];
        const sscc18 = toSscc18(companyPrefix, serialReference);
        return { scheme: "sscc", companyPrefix, serialReference, sscc18 };
    }
    return { scheme: "unknown", raw };
}
//# sourceMappingURL=gs1.js.map