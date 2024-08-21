/**
 * Session Already Active Error
 */
export class SessionAlreadyActiveError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "SessionAlreadyActiveError";
    }
}