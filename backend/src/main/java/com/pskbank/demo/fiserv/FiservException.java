package com.pskbank.demo.fiserv;

/** Banking Hub answered, but with an EFX Status of Severity=Error (a business rejection, not an outage). */
public class FiservException extends RuntimeException {
    private final String efxCode;
    private final String efxDesc;
    private final String provider;

    public FiservException(String efxCode, String efxDesc, String provider) {
        super("Fiserv EFX error " + efxCode + ": " + efxDesc);
        this.efxCode = efxCode;
        this.efxDesc = efxDesc;
        this.provider = provider;
    }

    public String efxCode() { return efxCode; }
    public String efxDesc() { return efxDesc; }
    public String provider() { return provider; }
}
