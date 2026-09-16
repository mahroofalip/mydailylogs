
organizationID = organization.get("organization_id");
login_url = "https://api.instahealthsolutions.com/nadz/Customer/Login.do?_method=login&hospital_name=nadz";
headers_map = Map();
headers_map.put("x-insta-auth","APIPatient:API@nadz2025");
login_response = getUrl(login_url,headers_map);
login_map = login_response.toMap();
handler_key = ifnull(login_map.get("request_handler_key"),"");
from_date = "01-06-2026";
to_date = "30-06-2026";
// --- VAT TREATMENT CONFIG ---
// Open one of the bills already invoiced in Zoho Books (e.g. BL000177, BN000003)
// and copy the value shown in its "VAT Treatment" field here. That value is
// guaranteed to be valid for this org since it's already accepted there.
treatment_value = "vat_registered";
voucher_url = "https://api.instahealthsolutions.com/nadz/api/accounting/vouchers/list.json?from_date=" + from_date + "&center_id=0&account_group_id=1&open_only=false&to_date=" + to_date;
voucher_headers = Map();
voucher_headers.put("request_handler_key",handler_key);
voucher_response = getUrl(voucher_url,voucher_headers);
voucher_map = voucher_response.toMap();
vouchers = ifnull(voucher_map.get("result"),list());
bill_groups = Map();
for each  v in vouchers




=======================================================================



// ============================================================================
// AllUp Fitness - Daily Invoice Generator (Deluge)
// ============================================================================

// Configuration
CONFIG = Map();
CONFIG.put("API_URL", "https://api.allupfitness.com/orders/sync/transactions");
CONFIG.put("SECRET_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJneW1JZCI6ImFmMjQ2YTU1LTNlNDMtNGE1Zi1hNzY4LWMwMDVkMGE3MWRhZCIsImd5bUlkcyI6ImFmMjQ2YTU1LTNlNDMtNGE1Zi1hNzY4LWMwMDVkMGE3MWRhZCxiNTM0ODYwYS1kZjM2LTQxOTEtOGRmZC0zZmNiZWRlYTIxMTQsM2E5Y2IwMjYtMWRlNi00OWI0LThlMjItMzhhM2NlMzE4OTA3LDE5MTFlNTljLWIwNGUtNGE2MS1iYWVlLTFmNjkwNzA1MmQ2MiwzOWNhMzljMy0yMzlhLTQzMWUtOTA2ZC01NzM1MjE1NmIxMTksM2RiNjQyOWItMmY2MS00NjEwLTkwNzgtYTI5YmFjODM3MzNiIiwicm9sZSI6InN1cGVyIGFkbWluIiwiaWF0IjoxNzc1NTk1MDU4LCJleHAiOjIwOTExNzEwNTh9.P7QgsZgzLyKXVZmgINu9kmujGTNZ17n9EzvQFX7S5w0");

// ============================================================================
// MAIN FUNCTION
// ============================================================================
void createDailyInvoices() {
    info("Starting Daily Invoice Generation");
    
    try {
        transactions_map = fetchTransactions(1, 60);
        
        if(transactions_map.containsKey("error")) {
            error("Failed to fetch: " + transactions_map.get("error"));
            return;
        }
        
        grouped_data = groupTransactionsByGymAndDate(transactions_map.get("data"));
        created_invoices = createInvoicesFromGroupedData(grouped_data);
        
        info("Successfully created " + created_invoices.size() + " invoices");
        
    } catch (Exception e) {
        error("Error: " + e.getMessage());
    }
}

// ============================================================================
// FETCH TRANSACTIONS FROM API
// ============================================================================
fetchTransactions(page, limit) {
    result = Map();
    
    try {
        url = CONFIG.get("API_URL") + "?page=" + page + "&limit=" + limit;
        
        headers_map = Map();
        headers_map.put("x-secret-key", CONFIG.get("SECRET_KEY"));
        headers_map.put("Content-Type", "application/json");
        
        response = invokeurl(
            [
                url: url,
                type: "GET",
                headers: headers_map,
                timeout: 30
            ]
        );
        
        if(response.containsKey("data")) {
            result.put("data", response.get("data"));
            result.put("pagination", response.get("pagination"));
            info("Fetched transactions successfully");
        } else {
            result.put("error", "Invalid response format");
        }
        
    } catch (Exception e) {
        result.put("error", e.getMessage());
        error("API Error: " + e.getMessage());
    }
    
    return result;
}

// ============================================================================
// GROUP TRANSACTIONS BY GYM + DATE
// ============================================================================
groupTransactionsByGymAndDate(transactions_list) {
    grouped_map = Map();
    
    for each(transaction in transactions_list) {
        created_at = transaction.get("createdAt").toString();
        date_only = created_at.subString(0, 10);
        
        gym_id = transaction.get("gymId").toString();
        gym_name = transaction.get("gymName").toString();
        group_key = gym_id + "_" + date_only;
        
        if(!grouped_map.containsKey(group_key)) {
            group_info = Map();
            group_info.put("gymId", gym_id);
            group_info.put("gymName", gym_name);
            group_info.put("date", date_only);
            group_info.put("transactions", List());
            grouped_map.put(group_key, group_info);
        }
        
        group_data = grouped_map.get(group_key);
        transactions_in_group = group_data.get("transactions");
        transactions_in_group.add(transaction);
        group_data.put("transactions", transactions_in_group);
        grouped_map.put(group_key, group_data);
    }
    
    info("Grouped into " + grouped_map.size() + " gym/date combinations");
    return grouped_map;
}

// ============================================================================
// CREATE INVOICES FROM GROUPED DATA
// ============================================================================
createInvoicesFromGroupedData(grouped_data) {
    created_invoices = List();
    
    for each(group_key in grouped_data.keys()) {
        group_info = grouped_data.get(group_key);
        transactions = group_info.get("transactions");
        
        if(transactions.size() > 0) {
            gym_id = group_info.get("gymId");
            gym_name = group_info.get("gymName");
            date_only = group_info.get("date");
            
            first_txn = transactions.get(0);
            currency = first_txn.get("currency").toString();
            
            summary_map = calculateSummaryByType(transactions);
            line_items = createLineItems(transactions);
            
            invoice = createInvoice(gym_id, gym_name, date_only, currency, summary_map, line_items);
            created_invoices.add(invoice);
            
            info("Created invoice for " + gym_name + " on " + date_only);
        }
    }
    
    return created_invoices;
}

// ============================================================================
// CALCULATE SUMMARY BY TRANSACTION TYPE
// ============================================================================
calculateSummaryByType(transactions_list) {
    summary_map = Map();
    
    total_charges = 0.0;
    total_refunds = 0.0;
    total_payments = 0.0;
    
    for each(txn in transactions_list) {
        type = txn.get("type").toString();
        amount = txn.get("amount").toDecimal();
        
        if(type.equalsIgnoreCase("charge")) {
            total_charges = total_charges + amount;
        } else if(type.equalsIgnoreCase("refund")) {
            total_refunds = total_refunds + amount;
        } else if(type.equalsIgnoreCase("payment")) {
            total_payments = total_payments + amount;
        }
    }
    
    summary_map.put("totalCharges", total_charges);
    summary_map.put("totalRefunds", total_refunds);
    summary_map.put("totalPayments", total_payments);
    summary_map.put("netAmount", total_charges - total_refunds + total_payments);
    
    return summary_map;
}

// ============================================================================
// CREATE LINE ITEMS (ONE PER CUSTOMER)
// ============================================================================
createLineItems(transactions_list) {
    line_items = List();
    customer_summary = Map();
    
    for each(txn in transactions_list) {
        customer_id = txn.get("customerId").toString();
        amount = txn.get("amount").toDecimal();
        order_type = txn.get("orderTypeLabel").toString();
        
        if(!customer_summary.containsKey(customer_id)) {
            cust_data = Map();
            cust_data.put("customerId", customer_id);
            cust_data.put("totalAmount", 0.0);
            cust_data.put("itemCount", 0);
            customer_summary.put(customer_id, cust_data);
        }
        
        cust_data = customer_summary.get(customer_id);
        cust_data.put("totalAmount", cust_data.get("totalAmount").toDecimal() + amount);
        cust_data.put("itemCount", cust_data.get("itemCount").toInt() + 1);
        customer_summary.put(customer_id, cust_data);
    }
    
    // Convert to line items
    for each(customer_id in customer_summary.keys()) {
        cust_data = customer_summary.get(customer_id);
        
        line_item = Map();
        line_item.put("customerId", customer_id);
        line_item.put("itemCount", cust_data.get("itemCount"));
        line_item.put("lineItemAmount", cust_data.get("totalAmount"));
        line_item.put("description", "Daily charges - " + cust_data.get("itemCount") + " transactions");
        
        line_items.add(line_item);
    }
    
    return line_items;
}

// ============================================================================
// CREATE INVOICE RECORD
// ============================================================================
createInvoice(gym_id, gym_name, date_only, currency, summary_map, line_items) {
    
    invoice = Map();
    invoice_number = generateInvoiceNumber(gym_name, date_only);
    
    invoice.put("invoiceNumber", invoice_number);
    invoice.put("gymId", gym_id);
    invoice.put("gymName", gym_name);
    invoice.put("invoiceDate", date_only);
    invoice.put("currency", currency);
    invoice.put("status", "DRAFT");
    invoice.put("totalCharges", summary_map.get("totalCharges"));
    invoice.put("totalRefunds", summary_map.get("totalRefunds"));
    invoice.put("totalPayments", summary_map.get("totalPayments"));
    invoice.put("netAmount", summary_map.get("netAmount"));
    invoice.put("lineItems", line_items);
    invoice.put("lineItemCount", line_items.size());
    invoice.put("createdAt", now);
    
    info("Invoice created: " + invoice_number);
    
    return invoice;
}

// ============================================================================
// GENERATE INVOICE NUMBER
// ============================================================================
generateInvoiceNumber(gym_name, date_only) {
    gym_code = gym_name.replaceAll(" ", "").subString(0, 3).toUpperCase();
    date_code = date_only.replaceAll("-", "").subString(2);
    timestamp_str = now.toString().replaceAll("[^0-9]", "");
    suffix = timestamp_str.subString(timestamp_str.length() - 4);
    
    return gym_code + "-" + date_code + "-" + suffix;
}

// ============================================================================
// EXECUTION
// ============================================================================
createDailyInvoices();