package com.pskbank.demo.plaid;

/** Plaid returned an error object (error_type / error_code / display_message). */
public class PlaidException extends RuntimeException {
    private final String errorCode;
    private final String displayMessage;

    public PlaidException(String errorCode, String errorMessage, String displayMessage) {
        super("Plaid " + errorCode + ": " + errorMessage);
        this.errorCode = errorCode;
        this.displayMessage = displayMessage;
    }

    public String errorCode() { return errorCode; }

    public String safeMessage() {
        return displayMessage != null && !displayMessage.isBlank() ? displayMessage : "External account provider error (" + errorCode + ")";
    }
}
