// ============================================================================
// ALLUP FITNESS -> ZOHO BOOKS
// DAILY INVOICE + PAYMENT + CREDIT NOTE SYNC
// ============================================================================
//
// FLOW
// -----
// AllUp API
//    |
//    +-- SUCCESS + charge --> Zoho Sales Invoice
//    |                         |
//    |                         +--> Zoho Customer Payment
//    |
//    +-- SUCCESS + refund --> Zoho Credit Note --> Applied to same Invoice
//
// GROUPING
// --------
// Gym ID + Transaction Date = ONE DAILY INVOICE
//
// PAYMENT
// -------
// Payment is grouped by payment method.
// Example:
// CARD = 500
// CASH = 100
// BANK = 200
//
// Then:
// Invoice = 800
// Payment CARD = 500
// Payment CASH = 100
// Payment BANK = 200
//
// LINE ITEM NAMING
// ----------------
// AllUp customer names are resolved via a batched lookup call
// (POST /customers/details) before grouping, and cached in
// customerNameMap so every line item description shows the
// member's name instead of a raw customerId UUID. If a name
// can't be resolved, the code falls back to "Member: <id>".
//
// CREDIT NOTES
// ------------
// Every credit note created from a refund is applied against
// the SAME gym+date daily invoice (matched by reference_number)
// via POST /creditnotes/{id}/invoices, so it shows up correctly
// under the invoice's INVOICE# column in Zoho Books.
//
// DUPLICATE PREVENTION
// --------------------
// AllUp transactionId is used as the unique reference.
//
// ============================================================================
// ============================================================================
// CONFIGURATION
// ============================================================================
CONFIG = Map();
// -----------------------------------------------------------------------------
// ALLUP
// -----------------------------------------------------------------------------
CONFIG.put("ALLUP_API_URL","https://api.allupfitness.com/orders/sync/transactions");
CONFIG.put("ALLUP_CUSTOMER_URL","https://api.allupfitness.com/customers/details");
// IMPORTANT:
// DO NOT put the real JWT in production code.
// Use a secure variable / connection / environment configuration.
CONFIG.put("ALLUP_SECRET","eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJneW1JZCI6ImFmMjQ2YTU1LTNlNDMtNGE1Zi1hNzY4LWMwMDVkMGE3MWRhZCIsImd5bUlkcyI6ImFmMjQ2YTU1LTNlNDMtNGE1Zi1hNzY4LWMwMDVkMGE3MWRhZCxiNTM0ODYwYS1kZjM2LTQxOTEtOGRmZC0zZmNiZWRlYTIxMTQsM2E5Y2IwMjYtMWRlNi00OWI0LThlMjItMzhhM2NlMzE4OTA3LDE5MTFlNTljLWIwNGUtNGE2MS1iYWVlLTFmNjkwNzA1MmQ2MiwzOWNhMzljMy0yMzlhLTQzMWUtOTA2ZC01NzM1MjE1NmIxMTksM2RiNjQyOWItMmY2MS00NjEwLTkwNzgtYTI5YmFjODM3MzNiIiwicm9sZSI6InN1cGVyIGFkbWluIiwiaWF0IjoxNzc1NTk1MDU4LCJleHAiOjIwOTExNzEwNTh9.P7QgsZgzLyKXVZmgINu9kmujGTNZ17n9EzvQFX7S5w0");
// -----------------------------------------------------------------------------
// ZOHO BOOKS
// -----------------------------------------------------------------------------
CONFIG.put("ZOHO_API_BASE","https://www.zohoapis.com/books/v3");
// Your Zoho Books Organization ID
CONFIG.put("ZOHO_ORGANIZATION_ID",organization.get("organization_id"));
// OAuth connection created in Zoho
CONFIG.put("ZOHO_CONNECTION","zohobooks_oauth");
// -----------------------------------------------------------------------------
// ZOHO ITEM
// -----------------------------------------------------------------------------
//
// Create a Zoho Books service item:
//
// "AllUp Daily Transaction"
//
// Then put the Zoho item_id here.
// -----------------------------------------------------------------------------
// OPTIONAL PAYMENT ACCOUNT
// -----------------------------------------------------------------------------
//
// If your Zoho Books setup requires account_id for payments,
// configure it here.
//
// Example:
// 100000000000001
//
// Leave blank if not required.
//
CONFIG.put("ZOHO_PAYMENT_ACCOUNT_ID","");
// -----------------------------------------------------------------------------
// PAGINATION
// -----------------------------------------------------------------------------
//
//
// We check a fixed maximum number of pages.
// The loop stops early when:
// 1. data is empty
// 2. returned records < pageSize
//
// -----------------------------------------------------------------------------
pageSize = 50;
// -----------------------------------------------------------------------------
// CUSTOMER LOOKUP BATCHING
// -----------------------------------------------------------------------------
//
// AllUp's /customers/details endpoint accepts an array of customerIds.
// This is the max number of IDs sent per call. Adjust if AllUp documents
// a different limit.
//
// -----------------------------------------------------------------------------
customerBatchSize = 50;
// ============================================================================
// MASTER TRANSACTION LIST
// ============================================================================
allTransactions = List();
//////////////////////////////////////
// ============================================================================
// 1. FETCH ALL ALLUP TRANSACTIONS
// ============================================================================
pages = {1,2};
for each  pageNumber in pages
{
	// ------------------------------------------------------------------------
	// AllUp URL
	// ------------------------------------------------------------------------
	allUpUrl = CONFIG.get("ALLUP_API_URL") + "?page=" + pageNumber + "&limit=" + pageSize + "&date=2026-09-02";
	// ------------------------------------------------------------------------
	// AllUp Headers
	// ------------------------------------------------------------------------
	voucher_headers = Map();
	voucher_headers.put("x-secret-key",CONFIG.get("ALLUP_SECRET"));
	// ------------------------------------------------------------------------
	// GET ALLUP DATA
	// ------------------------------------------------------------------------
	info "allUpUrl ========= :" + allUpUrl;
	all_transaction_resp = getUrl(allUpUrl,voucher_headers);
	info "====================================================";
	info "ALLUP PAGE: " + pageNumber;
	info all_transaction_resp;
	if(all_transaction_resp == null)
	{
		info "AllUp returned NULL.";
		break;
	}
	// ------------------------------------------------------------------------
	// GET DATA ARRAY
	// ------------------------------------------------------------------------
	transactionData = all_transaction_resp.get("data");
	if(transactionData == null)
	{
		info "No data property found.";
		break;
	}
	if(transactionData.isEmpty())
	{
		info "No more transactions.";
		break;
	}
	// ------------------------------------------------------------------------
	// ADD TO MASTER LIST
	// ------------------------------------------------------------------------
	for each  transaction in transactionData
	{
		allTransactions.add(transaction);
	}
	info "Records in page: " + transactionData.size();
	// ------------------------------------------------------------------------
	// LAST PAGE CHECK
	// ------------------------------------------------------------------------
	if(transactionData.size() < pageSize)
	{
		info "Last page reached.";
		break;
	}
}
info "====================================================";
info "TOTAL ALLUP TRANSACTIONS: " + allTransactions.size();
info "====================================================";
// ============================================================================
// 1.5 RESOLVE CUSTOMER NAMES (batched)
// ============================================================================
//
// Collect every unique customerId that appears across all transactions,
// then resolve them to full names via AllUp's /customers/details endpoint
// in chunks of customerBatchSize. Results are cached in customerNameMap
// (customerId -> fullName) and reused for every invoice/credit-note line
// item below, instead of doing a lookup per transaction.
//
// ============================================================================
customerIdSet = Map(); // used as a set: id -> true
for each  txn in allTransactions
{
	cId = ifnull(txn.get("customerId"),"");
	if(cId != "")
	{
		customerIdSet.put(cId,true);
	}
}

uniqueCustomerIds = customerIdSet.keys();
info "Unique customer IDs to resolve: " + uniqueCustomerIds.size();

customerNameMap = Map(); // customerId -> fullName

totalCustomers = uniqueCustomerIds.size();
batchCounter = 0; // used only for logging batch numbers
currentBatch = List();

// ----------------------------------------------------------------------------
// Helper-less batching: accumulate IDs into currentBatch, and every time it
// reaches customerBatchSize, resolve it immediately and reset the batch.
// requests instead of sending one call per customerId.
// ----------------------------------------------------------------------------
for each  cIdToBatch in uniqueCustomerIds
{
	currentBatch.add(cIdToBatch);

	if(currentBatch.size() >= customerBatchSize)
	{
		batchCounter = batchCounter + 1;

		customerHeaders = Map();
		customerHeaders.put("x-secret-key",CONFIG.get("ALLUP_SECRET"));
		customerHeaders.put("Content-Type","application/json");

		customerPayload = Map();
		customerPayload.put("customerIds",currentBatch);

		customerResp = invokeurl
		[
			url :CONFIG.get("ALLUP_CUSTOMER_URL")
			type :POST
			parameters:customerPayload.toString()
			headers:customerHeaders
		];

		info "Customer batch " + batchCounter + " (" + currentBatch.size() + " ids) response:";
		info customerResp;

		if(customerResp != null && customerResp.get("data") != null)
		{
			custDataList = customerResp.get("data");
			for each  custRec in custDataList
			{
				cId = ifnull(custRec.get("customerId"),"");
				cName = ifnull(custRec.get("fullName"),"");
				cName = cName.trim();
				if(cId != "" && cName != "")
				{
					customerNameMap.put(cId,cName);
				}
			}
		}
		else
		{
			info "WARNING: customer batch " + batchCounter + " lookup returned no data.";
		}

		currentBatch = List(); // reset for the next batch
	}
}

// ----------------------------------------------------------------------------
// Flush the last partial batch (fewer than customerBatchSize IDs left over)
// ----------------------------------------------------------------------------
if(currentBatch.size() > 0)
{
	batchCounter = batchCounter + 1;

	customerHeaders = Map();
	customerHeaders.put("x-secret-key",CONFIG.get("ALLUP_SECRET"));
	customerHeaders.put("Content-Type","application/json");

	customerPayload = Map();
	customerPayload.put("customerIds",currentBatch);

	customerResp = invokeurl
	[
		url :CONFIG.get("ALLUP_CUSTOMER_URL")
		type :POST
		parameters:customerPayload.toString()
		headers:customerHeaders
	];

	info "Customer batch " + batchCounter + " (" + currentBatch.size() + " ids, final) response:";
	info customerResp;

	if(customerResp != null && customerResp.get("data") != null)
	{
		custDataList = customerResp.get("data");
		for each  custRec in custDataList
		{
			cId = ifnull(custRec.get("customerId"),"");
			cName = ifnull(custRec.get("fullName"),"");
			cName = cName.trim();
			if(cId != "" && cName != "")
			{
				customerNameMap.put(cId,cName);
			}
		}
	}
	else
	{
		info "WARNING: final customer batch " + batchCounter + " lookup returned no data.";
	}
}

info "====================================================";
info "Resolved customer names: " + customerNameMap.size() + " / " + totalCustomers;
info "====================================================";
// ============================================================================
// 2. GROUP TRANSACTIONS BY GYM + DATE
// ============================================================================
chargeGroups = Map();
refundGroups = Map();
for each  txn in allTransactions
{
	transactionId = ifnull(txn.get("transactionId"),"");
	transactionType = ifnull(txn.get("type"),"");
	paymentStatus = ifnull(txn.get("paymentStatus"),"");
	gymId = ifnull(txn.get("gymId"),"");
	createdAt = ifnull(txn.get("createdAt"),"");
	gymName = ifnull(txn.get("gymName"),"");
	// ------------------------------------------------------------------------
	// Only SUCCESS transactions
	// ------------------------------------------------------------------------
	if(paymentStatus != "SUCCESS")
	{
		info "SKIP - Payment status is not SUCCESS: " + transactionId;
		continue;
	}
	if(gymId == "" || createdAt == "")
	{
		info "SKIP - Missing gymId or createdAt: " + transactionId;
		continue;
	}
	// ------------------------------------------------------------------------
	// Transaction date
	//
	// Example:
	// 2026-09-10T18:46:34Z
	//
	// Result:
	// 2026-09-10
	// ------------------------------------------------------------------------
	transactionDate = createdAt.subString(0,10);
	groupKey = gymId + "|" + transactionDate;
	// ------------------------------------------------------------------------
	// CHARGE
	// ------------------------------------------------------------------------
	if(transactionType == "charge")
	{
		if(!chargeGroups.containsKey(groupKey))
		{
			chargeGroups.put(groupKey,List());
		}
		groupList = chargeGroups.get(groupKey);
		groupList.add(txn);
		chargeGroups.put(groupKey,groupList);
	}
	// ------------------------------------------------------------------------
	// REFUND
	// ------------------------------------------------------------------------
	else if(transactionType == "refund")
	{
		if(!refundGroups.containsKey(groupKey))
		{
			refundGroups.put(groupKey,List());
		}
		groupList = refundGroups.get(groupKey);
		groupList.add(txn);
		refundGroups.put(groupKey,groupList);
	}
}
info "Charge groups: " + chargeGroups.size();
info "Refund groups: " + refundGroups.size();
// ============================================================================
// 3. PROCESS CHARGES
// ============================================================================
for each  groupKey in chargeGroups.keys()
{
	groupTransactions = chargeGroups.get(groupKey);
	if(groupTransactions == null || groupTransactions.isEmpty())
	{
		continue;
	}
	firstTransaction = groupTransactions.get(0);
	gymId = firstTransaction.get("gymId");
	gymName = ifnull(firstTransaction.get("gymName"),"AllUp Gym");
	batchDate = firstTransaction.get("createdAt").subString(0,10);
	info "====================================================";
	info "PROCESSING CHARGE GROUP";
	info "Gym: " + gymName;
	info "Gym ID: " + gymId;
	info "Date: " + batchDate;
	info "Transactions: " + groupTransactions.size();
	info "====================================================";
	// ========================================================================
	// 3.1 FIND OR CREATE ZOHO CUSTOMER
	// ========================================================================
	zohoCustomerId = null;
	contactUrl = CONFIG.get("ZOHO_API_BASE") + "/contacts" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID") + "&contact_type=customer" + "&per_page=200";
	contactResponse = invokeurl
	[
		url :contactUrl
		type :GET
		connection:"zohobooks_connection"
	];
	info "Zoho contacts response:";
	info contactResponse;
	contacts = contactResponse.get("contacts");
	// ------------------------------------------------------------------------
	// MATCH BY NAME (no custom field exists in this org)
	// ------------------------------------------------------------------------
	if(contacts != null)
	{
		for each  contact in contacts
		{
			existingName = ifnull(contact.get("contact_name"),"");
			if(existingName == gymName)
			{
				zohoCustomerId = contact.get("contact_id");
			}
		}
	}
	if(zohoCustomerId == null)
	{
		info "Zoho customer not found for gym: " + gymName + " (gymId: " + gymId + ") — creating new customer.";
		newContactPayload = Map();
		newContactPayload.put("contact_name",gymName);
		newContactPayload.put("company_name",gymName);
		newContactPayload.put("contact_type","customer");
		createContactUrl = CONFIG.get("ZOHO_API_BASE") + "/contacts" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID");
		createContactResponse = invokeurl
		[
			url :createContactUrl
			type :POST
			parameters:newContactPayload.toString()
			headers:{"Content-Type":"application/json"}
			connection:"zohobooks_connection"
		];
		info "Zoho create-contact response:";
		info createContactResponse;
		if(createContactResponse != null && createContactResponse.get("contact") != null)
		{
			zohoCustomerId = createContactResponse.get("contact").get("contact_id");
			info "Created new Zoho customer '" + gymName + "' | contact_id: " + zohoCustomerId;
		}
		else
		{
			// ----------------------------------------------------------------
			// FALLBACK: creation failed (likely "already exists", code 3062).
			// Re-fetch contacts and match by name again in case it was a
			// stale read or race condition.
			// ----------------------------------------------------------------
			info "Create failed — re-checking contacts by name as fallback.";
			retryContactResponse = invokeurl
			[
				url :contactUrl
				type :GET
				connection:"zohobooks_connection"
			];
			retryContacts = retryContactResponse.get("contacts");
			if(retryContacts != null)
			{
				for each  contact in retryContacts
				{
					existingName = ifnull(contact.get("contact_name"),"");
					if(existingName == gymName)
					{
						zohoCustomerId = contact.get("contact_id");
					}
				}
			}
			if(zohoCustomerId == null)
			{
				info "ERROR: Failed to auto-create or find Zoho customer for gym: " + gymName;
				continue;
			}
			else
			{
				info "Recovered existing customer '" + gymName + "' | contact_id: " + zohoCustomerId;
			}
		}
	}
	info "Zoho Customer ID: " + zohoCustomerId;
	// ========================================================================
	// 3.2 BUILD INVOICE LINE ITEMS
	// ========================================================================
	lineItems = List();
	totalAmount = 0.0;
	transactionIds = List();
	// Payment groups
	paymentGroups = Map();
	for each  txn in groupTransactions
	{
		transactionId = ifnull(txn.get("transactionId"),"");
		customerId = ifnull(txn.get("customerId"),"");
		orderType = ifnull(txn.get("orderType"),"ALLUP");
		orderTypeLabel = ifnull(txn.get("orderTypeLabel"),orderType);
		// --------------------------------------------------------------------
		// amount is used first; falls back to chargeAmount
		// --------------------------------------------------------------------
		amountValue = txn.get("amount");
		if(amountValue == null)
		{
			amountValue = txn.get("chargeAmount");
		}
		if(amountValue == null)
		{
			amountValue = 0;
		}
		amount = amountValue.toDecimal();
		// --------------------------------------------------------------------
		// Ignore zero-value transactions
		// --------------------------------------------------------------------
		if(amount <= 0)
		{
			info "SKIP ZERO AMOUNT: " + transactionId;
			continue;
		}
		// --------------------------------------------------------------------
		// RESOLVE CUSTOMER DISPLAY NAME (from customerNameMap, with fallback)
		// --------------------------------------------------------------------
		customerDisplayName = customerNameMap.get(customerId);
		if(customerDisplayName == null || customerDisplayName == "")
		{
			customerDisplayName = "Member: " + customerId;
		}
		// --------------------------------------------------------------------
		// INVOICE LINE
		// --------------------------------------------------------------------
		lineItem = Map();
		lineItem.put("item_id",null);
		lineItem.put("quantity",1);
		lineItem.put("rate",amount);
		lineItem.put("description",orderTypeLabel + " | AllUp Transaction: " + transactionId + " | " + customerDisplayName);
		lineItems.add(lineItem);
		totalAmount = totalAmount + amount;
		transactionIds.add(transactionId);
		// ====================================================================
		// PAYMENT METHOD GROUP
		// ====================================================================
		paymentDetails = ifnull(txn.get("paymentDetails"),Map());
		paymentMethod = ifnull(paymentDetails.get("method"),"OTHER");
		if(!paymentGroups.containsKey(paymentMethod))
		{
			paymentGroups.put(paymentMethod,0.0);
		}
		existingPaymentAmount = paymentGroups.get(paymentMethod);
		paymentGroups.put(paymentMethod,existingPaymentAmount + amount);
	}
	if(lineItems.isEmpty())
	{
		info "No billable transactions.";
		continue;
	}
	// ========================================================================
	// 3.3 BATCH ID / INVOICE NUMBER
	// ========================================================================
	batchId = gymId + "-" + batchDate + "-DAILY";
	// ------------------------------------------------------------------------
	// Build a readable invoice number: GYMBRANCH-YYYYMMDD
	// (Zoho requires invoice_number explicitly since auto-numbering is off)
	// ------------------------------------------------------------------------
	gymCode = gymName.replaceAll("[^a-zA-Z0-9]","").toUpperCase();
	if(gymCode.length() > 12)
	{
		gymCode = gymCode.subString(0,12);
	}
	dateCode = batchDate.replaceAll("-","");
	// 2026-09-15 -> 20260915
	invoiceNumber = gymCode + "-" + dateCode;
	// ========================================================================
	// 3.4 DUPLICATE CHECK — recover instead of skip
	// ========================================================================
	//
	// If an invoice already exists for this batchId (reference_number):
	//   - if fully paid (balance <= 0)  -> nothing to do, skip group
	//   - if balance > 0                -> payment was missed on a prior run;
	//                                      reuse this invoice_id and create
	//                                      the payment in section 3.6
	// If no invoice exists yet, one is created fresh in section 3.5.
	// ========================================================================
	duplicateInvoice = null;
	searchInvoiceUrl = CONFIG.get("ZOHO_API_BASE") + "/invoices" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID") + "&reference_number=" + encodeUrl(batchId);
	duplicateResponse = invokeurl
	[
		url :searchInvoiceUrl
		type :GET
		connection:"zohobooks_connection"
	];
	if(duplicateResponse != null && duplicateResponse.get("invoices") != null && !duplicateResponse.get("invoices").isEmpty())
	{
		duplicateInvoice = duplicateResponse.get("invoices").get(0);
	}
	zohoInvoiceId = null;
	zohoInvoiceNumber = null;
	if(duplicateInvoice != null)
	{
		info "EXISTING DAILY INVOICE FOUND — checking payment status instead of skipping.";
		zohoInvoiceId = duplicateInvoice.get("invoice_id");
		zohoInvoiceNumber = duplicateInvoice.get("invoice_number");
		invoiceBalance = duplicateInvoice.get("balance");
		invoiceStatus = duplicateInvoice.get("status");
		info "Invoice: " + zohoInvoiceNumber + " | Status: " + invoiceStatus + " | Balance: " + invoiceBalance;
		if(invoiceBalance == null || invoiceBalance.toDecimal() <= 0)
		{
			info "Invoice already fully paid. Skipping this group.";
			continue;
		}
		else
		{
			info "Invoice has outstanding balance (" + invoiceBalance + ") — payment was missed. Will create payment now against existing invoice.";
			// falls through to 3.6 using this existing zohoInvoiceId
		}
	}
	// ========================================================================
	// 3.5 CREATE ZOHO INVOICE (only if one doesn't already exist)
	// ========================================================================
	if(zohoInvoiceId == null)
	{
		invoicePayload = Map();
		invoicePayload.put("customer_id",zohoCustomerId);
		invoicePayload.put("date",batchDate);
		invoicePayload.put("invoice_number",invoiceNumber);
		invoicePayload.put("reference_number",batchId);
		invoicePayload.put("line_items",lineItems);
		info "====================================================";
		info "CREATE ZOHO INVOICE";
		info invoicePayload;
		info "====================================================";
		invoiceUrl = CONFIG.get("ZOHO_API_BASE") + "/invoices" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID");
		invoiceResponse = invokeurl
		[
			url :invoiceUrl
			type :POST
			parameters:invoicePayload.toString()
			headers:{"Content-Type":"application/json"}
			connection:"zohobooks_connection"
		];
		info "Zoho invoice response:";
		info invoiceResponse;
		if(invoiceResponse == null || invoiceResponse.get("invoice") == null)
		{
			info "ERROR: Invoice creation failed.";
			continue;
		}
		createdInvoice = invoiceResponse.get("invoice");
		zohoInvoiceId = createdInvoice.get("invoice_id");
		zohoInvoiceNumber = createdInvoice.get("invoice_number");
		info "====================================================";
		info "INVOICE CREATED";
		info "Invoice Number: " + zohoInvoiceNumber;
		info "Invoice ID: " + zohoInvoiceId;
		info "Total: " + totalAmount;
		info "====================================================";
	}
	else
	{
		info "Reusing existing invoice: " + zohoInvoiceNumber + " (ID: " + zohoInvoiceId + ")";
	}
	// ========================================================================
	// 3.6 CREATE PAYMENTS (runs whether invoice is new or pre-existing)
	// ========================================================================
	//
	// A separate payment is created for each AllUp payment method and
	// applied against zohoInvoiceId.
	//
	// Example:
	// CARD = 100, CASH = 50   ->  Invoice = 150
	//   Payment 1 = 100 CARD
	//   Payment 2 = 50 CASH
	//
	// ========================================================================
	for each  paymentMethod in paymentGroups.keys()
	{
		paymentAmount = paymentGroups.get(paymentMethod);
		if(paymentAmount <= 0)
		{
			continue;
		}
		// --------------------------------------------------------------------
		// MAP ALLUP PAYMENT METHOD -> ZOHO PAYMENT MODE
		// --------------------------------------------------------------------
		zohoPaymentMode = "others";
		if(paymentMethod == "CASH")
		{
			zohoPaymentMode = "cash";
		}
		else if(paymentMethod == "BANK" || paymentMethod == "BANK_TRANSFER")
		{
			zohoPaymentMode = "banktransfer";
		}
		else if(paymentMethod == "CARD" || paymentMethod == "CARD_OVER_COUNTER" || paymentMethod == "AMEX" || paymentMethod == "MADA" || paymentMethod == "VISA" || paymentMethod == "MASTERCARD")
		{
			zohoPaymentMode = "creditcard";
		}
		else
		{
			zohoPaymentMode = "others";
		}
		// --------------------------------------------------------------------
		// SHORT CODE FOR PAYMENT METHOD (keeps reference_number under 50 chars)
		// --------------------------------------------------------------------
		paymentMethodCode = "OTH";
		if(paymentMethod == "CASH")
		{
			paymentMethodCode = "CASH";
		}
		else if(paymentMethod == "BANK" || paymentMethod == "BANK_TRANSFER")
		{
			paymentMethodCode = "BANK";
		}
		else if(paymentMethod == "CARD" || paymentMethod == "CARD_OVER_COUNTER")
		{
			paymentMethodCode = "CARD";
		}
		else if(paymentMethod == "AMEX")
		{
			paymentMethodCode = "AMEX";
		}
		else if(paymentMethod == "MADA")
		{
			paymentMethodCode = "MADA";
		}
		else if(paymentMethod == "VISA")
		{
			paymentMethodCode = "VISA";
		}
		else if(paymentMethod == "MASTERCARD")
		{
			paymentMethodCode = "MC";
		}
		else if(paymentMethod == "APPLE_PAY")
		{
			paymentMethodCode = "APAY";
		}
		else if(paymentMethod == "GOOGLE_PAY")
		{
			paymentMethodCode = "GPAY";
		}
		else if(paymentMethod == "WALLET")
		{
			paymentMethodCode = "WLT";
		}
		// --------------------------------------------------------------------
		// SKIP IF THIS EXACT PAYMENT WAS ALREADY RECORDED
		// (protects against double-creating a payment on re-runs when the
		// invoice already existed but only PART of the payment was missing)
		//
		// Uses the SHORT invoiceNumber (GYMCODE-YYYYMMDD, ~21 chars) instead
		// of the long UUID-based batchId, since Zoho's reference_number field
		// has a hard 50-character limit (batchId alone can exceed that).
		// --------------------------------------------------------------------
		paymentRefNumber = invoiceNumber + "-" + paymentMethodCode;
		if(paymentRefNumber.length() > 49)
		{
			paymentRefNumber = paymentRefNumber.subString(0,49);
		}
		existingPayment = null;
		searchPaymentUrl = CONFIG.get("ZOHO_API_BASE") + "/customerpayments" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID") + "&reference_number=" + encodeUrl(paymentRefNumber);
		searchPaymentResponse = invokeurl
		[
			url :searchPaymentUrl
			type :GET
			connection:"zohobooks_connection"
		];
		if(searchPaymentResponse != null && searchPaymentResponse.get("customerpayments") != null && !searchPaymentResponse.get("customerpayments").isEmpty())
		{
			existingPayment = searchPaymentResponse.get("customerpayments").get(0);
		}
		if(existingPayment != null)
		{
			info "Payment already exists for " + paymentRefNumber + " — skipping.";
			continue;
		}
		// --------------------------------------------------------------------
		// PAYMENT PAYLOAD
		// --------------------------------------------------------------------
		paymentPayload = Map();
		paymentPayload.put("customer_id",zohoCustomerId);
		paymentPayload.put("payment_mode",zohoPaymentMode);
		paymentPayload.put("amount",paymentAmount);
		paymentPayload.put("date",batchDate);
		paymentPayload.put("reference_number",paymentRefNumber);
		paymentPayload.put("description","AllUp Daily Payment | " + gymName + " | " + batchDate + " | " + paymentMethod);
		// --------------------------------------------------------------------
		// APPLY PAYMENT TO INVOICE
		// --------------------------------------------------------------------
		invoicePayments = List();
		invoicePayment = Map();
		invoicePayment.put("invoice_id",zohoInvoiceId);
		invoicePayment.put("amount_applied",paymentAmount);
		invoicePayments.add(invoicePayment);
		paymentPayload.put("invoices",invoicePayments);
		// --------------------------------------------------------------------
		// ACCOUNT ID
		// --------------------------------------------------------------------
		paymentAccountId = CONFIG.get("ZOHO_PAYMENT_ACCOUNT_ID");
		if(paymentAccountId != null && paymentAccountId != "")
		{
			paymentPayload.put("account_id",paymentAccountId);
		}
		info "----------------------------------------------------";
		info "CREATE PAYMENT";
		info "Method: " + paymentMethod + " (code: " + paymentMethodCode + ")";
		info "Zoho Mode: " + zohoPaymentMode;
		info "Amount: " + paymentAmount;
		info "Reference Number: " + paymentRefNumber + " (" + paymentRefNumber.length() + " chars)";
		info paymentPayload;
		info "----------------------------------------------------";
		paymentUrl = CONFIG.get("ZOHO_API_BASE") + "/customerpayments" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID");
		paymentResponse = invokeurl
		[
			url :paymentUrl
			type :POST
			parameters:paymentPayload.toString()
			headers:{"Content-Type":"application/json"}
			connection:"zohobooks_connection"
		];
		info "Zoho payment response:";
		info paymentResponse;
		if(paymentResponse != null && paymentResponse.get("payment") != null)
		{
			createdPayment = paymentResponse.get("payment");
			info "PAYMENT CREATED";
			info "Payment ID: " + createdPayment.get("payment_id");
		}
		else
		{
			info "ERROR: Payment creation failed.";
			info paymentResponse;
		}
	}
}
// ============================================================================
// 4. PROCESS REFUNDS -> CREDIT NOTES (applied to the same daily invoice)
// ============================================================================
for each  groupKey in refundGroups.keys()
{
	refundTransactions = refundGroups.get(groupKey);
	if(refundTransactions == null || refundTransactions.isEmpty())
	{
		continue;
	}
	firstRefund = refundTransactions.get(0);
	gymId = firstRefund.get("gymId");
	gymName = ifnull(firstRefund.get("gymName"),"AllUp Gym");
	refundDate = firstRefund.get("createdAt").subString(0,10);
	info "====================================================";
	info "PROCESSING REFUND GROUP";
	info "Gym: " + gymName;
	info "Gym ID: " + gymId;
	info "Date: " + refundDate;
	info "Refunds: " + refundTransactions.size();
	info "====================================================";
	// ========================================================================
	// FIND OR CREATE ZOHO CUSTOMER (same name-match logic as charges)
	// ========================================================================
	zohoCustomerId = null;
	contactUrl = CONFIG.get("ZOHO_API_BASE") + "/contacts" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID") + "&contact_type=customer" + "&per_page=200";
	contactResponse = invokeurl
	[
		url :contactUrl
		type :GET
		connection:"zohobooks_connection"
	];
	contacts = contactResponse.get("contacts");
	if(contacts != null)
	{
		for each  contact in contacts
		{
			existingName = ifnull(contact.get("contact_name"),"");
			if(existingName == gymName)
			{
				zohoCustomerId = contact.get("contact_id");
			}
		}
	}
	if(zohoCustomerId == null)
	{
		info "Zoho customer not found for refund gym: " + gymName + " — creating new customer.";
		newContactPayload = Map();
		newContactPayload.put("contact_name",gymName);
		newContactPayload.put("company_name",gymName);
		newContactPayload.put("contact_type","customer");
		createContactUrl = CONFIG.get("ZOHO_API_BASE") + "/contacts" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID");
		createContactResponse = invokeurl
		[
			url :createContactUrl
			type :POST
			parameters:newContactPayload.toString()
			headers:{"Content-Type":"application/json"}
			connection:"zohobooks_connection"
		];
		if(createContactResponse != null && createContactResponse.get("contact") != null)
		{
			zohoCustomerId = createContactResponse.get("contact").get("contact_id");
			info "Created new Zoho customer '" + gymName + "' | contact_id: " + zohoCustomerId;
		}
		else
		{
			retryContactResponse = invokeurl
			[
				url :contactUrl
				type :GET
				connection:"zohobooks_connection"
			];
			retryContacts = retryContactResponse.get("contacts");
			if(retryContacts != null)
			{
				for each  contact in retryContacts
				{
					existingName = ifnull(contact.get("contact_name"),"");
					if(existingName == gymName)
					{
						zohoCustomerId = contact.get("contact_id");
					}
				}
			}
			if(zohoCustomerId == null)
			{
				info "ERROR: Refund customer could not be found or created for gym: " + gymName;
				continue;
			}
		}
	}
	// ========================================================================
	// LOOK UP THE SAME GYM+DATE DAILY INVOICE (to apply credit notes against)
	// ========================================================================
	refundBatchId = gymId + "-" + refundDate + "-DAILY";
	targetInvoiceId = null;
	targetInvoiceBalance = 0.0;
	searchTargetInvoiceUrl = CONFIG.get("ZOHO_API_BASE") + "/invoices" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID") + "&reference_number=" + encodeUrl(refundBatchId);
	targetInvoiceResponse = invokeurl
	[
		url :searchTargetInvoiceUrl
		type :GET
		connection:"zohobooks_connection"
	];
	if(targetInvoiceResponse != null && targetInvoiceResponse.get("invoices") != null && !targetInvoiceResponse.get("invoices").isEmpty())
	{
		targetInvoice = targetInvoiceResponse.get("invoices").get(0);
		targetInvoiceId = targetInvoice.get("invoice_id");
		targetInvoiceBalance = targetInvoice.get("balance").toDecimal();
		info "Matching daily invoice found for credit notes: " + targetInvoice.get("invoice_number") + " (balance: " + targetInvoiceBalance + ")";
	}
	else
	{
		info "WARNING: No matching daily invoice found for gym/date " + refundBatchId + " — credit notes will be created but left unapplied.";
	}
	// ========================================================================
	// CREATE ONE CREDIT NOTE PER REFUND (duplicate-checked), then apply it
	// ========================================================================
	for each  refundTxn in refundTransactions
	{
		transactionId = ifnull(refundTxn.get("transactionId"),"");
		customerId = ifnull(refundTxn.get("customerId"),"");
		// --------------------------------------------------------------------
		// Refund amount
		// --------------------------------------------------------------------
		refundAmountValue = refundTxn.get("refundAmount");
		if(refundAmountValue == null)
		{
			refundAmountValue = refundTxn.get("amount");
		}
		if(refundAmountValue == null)
		{
			refundAmountValue = 0;
		}
		refundAmount = refundAmountValue.toDecimal();
		if(refundAmount <= 0)
		{
			info "SKIP zero refund: " + transactionId;
			continue;
		}
		orderType = ifnull(refundTxn.get("orderType"),"ALLUP");
		orderTypeLabel = ifnull(refundTxn.get("orderTypeLabel"),orderType);
		originalInvoice = ifnull(refundTxn.get("invoiceNo"),"");
		// --------------------------------------------------------------------
		// RESOLVE CUSTOMER DISPLAY NAME (from customerNameMap, with fallback)
		// --------------------------------------------------------------------
		customerDisplayName = customerNameMap.get(customerId);
		if(customerDisplayName == null || customerDisplayName == "")
		{
			customerDisplayName = "Member: " + customerId;
		}
		// ====================================================================
		// CREDIT NOTE REFERENCE
		// ====================================================================
		creditNoteReference = "ALLUP-REFUND-" + transactionId;
		// ====================================================================
		// DUPLICATE CHECK — skip if this refund already has a credit note
		// ====================================================================
		existingCreditNote = null;
		searchCreditNoteUrl = CONFIG.get("ZOHO_API_BASE") + "/creditnotes" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID") + "&reference_number=" + encodeUrl(creditNoteReference);
		searchCreditNoteResponse = invokeurl
		[
			url :searchCreditNoteUrl
			type :GET
			connection:"zohobooks_connection"
		];
		if(searchCreditNoteResponse != null && searchCreditNoteResponse.get("creditnotes") != null && !searchCreditNoteResponse.get("creditnotes").isEmpty())
		{
			existingCreditNote = searchCreditNoteResponse.get("creditnotes").get(0);
		}
		if(existingCreditNote != null)
		{
			info "Credit note already exists for refund " + transactionId + " — skipping.";
			continue;
		}
		// ====================================================================
		// CREDIT NOTE LINE
		// ====================================================================
		creditNoteLine = Map();
		creditNoteLine.put("item_id",null);
		creditNoteLine.put("quantity",1);
		creditNoteLine.put("rate",refundAmount);
		creditNoteLine.put("description",orderTypeLabel + " | AllUp Refund: " + transactionId + " | " + customerDisplayName + " | Original Invoice: " + originalInvoice);
		creditNoteLines = List();
		creditNoteLines.add(creditNoteLine);
		// ====================================================================
		// CREDIT NOTE PAYLOAD
		// ====================================================================
		creditNotePayload = Map();
		creditNotePayload.put("customer_id",zohoCustomerId);
		creditNotePayload.put("date",refundDate);
		creditNotePayload.put("reference_number",creditNoteReference);
		creditNotePayload.put("line_items",creditNoteLines);
		info "====================================================";
		info "CREATE CREDIT NOTE";
		info creditNotePayload;
		info "====================================================";
		creditNoteUrl = CONFIG.get("ZOHO_API_BASE") + "/creditnotes" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID");
		creditNoteResponse = invokeurl
		[
			url :creditNoteUrl
			type :POST
			parameters:creditNotePayload.toString()
			headers:{"Content-Type":"application/json"}
			connection:"zohobooks_connection"
		];
		info "Zoho credit note response:";
		info creditNoteResponse;
		if(creditNoteResponse != null && creditNoteResponse.get("creditnote") != null)
		{
			createdCreditNote = creditNoteResponse.get("creditnote");
			creditNoteId = createdCreditNote.get("creditnote_id");
			info "CREDIT NOTE CREATED";
			info "Credit Note ID: " + creditNoteId;
			// ================================================================
			// APPLY CREDIT NOTE TO THE SAME GYM+DATE DAILY INVOICE
			// ================================================================
			if(targetInvoiceId != null)
			{
				// don't try to apply more than the invoice currently owes
				amountToApply = refundAmount;
				if(amountToApply > targetInvoiceBalance)
				{
					amountToApply = targetInvoiceBalance;
				}
				if(amountToApply > 0)
				{
					applyInvoiceLine = Map();
					applyInvoiceLine.put("invoice_id",targetInvoiceId);
					applyInvoiceLine.put("amount_applied",amountToApply);
					applyInvoicesList = List();
					applyInvoicesList.add(applyInvoiceLine);
					applyPayload = Map();
					applyPayload.put("invoices",applyInvoicesList);
					applyUrl = CONFIG.get("ZOHO_API_BASE") + "/creditnotes/" + creditNoteId + "/invoices" + "?organization_id=" + CONFIG.get("ZOHO_ORGANIZATION_ID");
					applyResponse = invokeurl
					[
						url :applyUrl
						type :POST
						parameters:applyPayload.toString()
						headers:{"Content-Type":"application/json"}
						connection:"zohobooks_connection"
					];
					info "Applied credit note " + creditNoteId + " to invoice " + targetInvoiceId + " for " + amountToApply + ":";
					info applyResponse;
					// keep running balance in sync in case there are
					// multiple refunds against the same invoice in this batch
					targetInvoiceBalance = targetInvoiceBalance - amountToApply;
				}
				else
				{
					info "Target invoice already fully credited — credit note left unapplied for this refund.";
				}
			}
			else
			{
				info "No matching daily invoice was found earlier for this group — credit note left unapplied.";
			}
		}
		else
		{
			info "ERROR: Credit Note creation failed.";
			info creditNoteResponse;
		}
	}
}
// ============================================================================
// 5. COMPLETE
// ============================================================================
info "====================================================";
info "ALLUP -> ZOHO BOOKS SYNC COMPLETE";
info "Total AllUp transactions: " + allTransactions.size();
info "Charge groups: " + chargeGroups.size();
info "Refund groups: " + refundGroups.size();
info "====================================================";
