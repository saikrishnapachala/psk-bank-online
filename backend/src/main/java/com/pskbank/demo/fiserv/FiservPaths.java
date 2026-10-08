package com.pskbank.demo.fiserv;

/**
 * Banking Hub API paths (appended to the Host URL from your workspace's Credentials tab).
 * Taken from the Developer Studio API Explorer, Premier core (the Trial plan's shared sandbox).
 */
public final class FiservPaths {
    private FiservPaths() {}

    /** Get Account Details. Body: {"AcctSel":{"AcctKeys":{"AcctId","AcctType"}}}. AcctType: SDA, DDA, CDA, LOAN. */
    public static final String ACCOUNT_INQUIRY = "/acctservice/acctmgmt/accounts/secured";

    /** Get Account Transaction History. Body: {"RecCtrlIn":{...},"AcctTrnSel":{"AcctKeys":{...},"DtRange":[...]}}. */
    public static final String TRANSACTION_HISTORY = "/accttranservice/acctmgmt/acctTrn/secured";

    /** Add Transfer (immediate, between two accounts on the core). Body: {"XferInfo":{FromAcctRef,ToAcctRef,CurAmt}}. */
    public static final String ADD_TRANSFER = "/xferservice/payments/transfers";
}
