
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
{
	if(v.get("voucher_type").trim() == "RECEIPT" || v.get("voucher_type").trim() == "HOSPBILLS" || v.get("voucher_type").trim() == "PAYMENT")
	{
		bn = ifnull(v.get("bill_no"),"");
		if(bn.trim() == "")
		{
			bn = ifnull(v.get("voucher_no"),"");
		}
		bn = bn.trim();
		if(bn != "")
		{
			existing = bill_groups.get(bn);
			if(existing == null)
			{
				existing = list();
			}
			existing.add(v);
			bill_groups.put(bn,existing);
		}
	}
}
sendmail
[
	from :zoho.loginuserid
	to :"manisha@zocoden.com"
	subject :"bill_groups : " + from_date
	message :bill_groups
]
group_keys = bill_groups.keys();
totalItems = group_keys.size();
reversedList = list();
for each index i in group_keys
{
	// Subtract the index loop to fetch from the back
	item = group_keys.get(totalItems - 1 - i);
	reversedList.add(item);
}
sendmail
[
	from :zoho.loginuserid
	to :"manisha@zocoden.com"
	subject :"reversedList : " + from_date
	message :reversedList
]
drList = list();
otherList = list();
for each  item in reversedList
{
	if(item.startsWith("DR"))
	{
		drList.add(item);
	}
	else
	{
		otherList.add(item);
	}
}
result = List();
result.addAll(drList);
result.addAll(otherList);
sendmail
[
	from :zoho.loginuserid
	to :"manisha@zocoden.com"
	subject :"result : " + from_date
	message :result
]
for each  bkey in result
{
	// 	info "bkey : " + bkey;
	records = bill_groups.get(bkey);
	header = null;
	header2 = null;
	line_items = list();
	dep_line_items = list();
	depcnLineItems = list();
	dep_come_bill_line_items = list();
	total_amount = 0.0;
	r_total_amount = 0.0;
	total_discount = 0.0;
	department = "";
	doctor = "";
	voucher_no = "";
	bill_no = "";
	mr_no = "";
	voucher_sub_type = "";
	has_bill_settlement = false;
	cnLineItems = list();
	apply_amount = 0.0;
	thisamnt = 0.0;
	unapplied_payment_id = "";
	payment_id_list = List();
	skip_deps_hb = false;
	unapplied_amount = 0.0;
	refunded_amount = 0.0;
	start = false;
	for each  rectest in records
	{
		if(rectest.get("voucher_sub_type").trim() == "DEP SETTLEMENT")
		{
			start = true;
			skip_deps_hb = true;
			break;
		}
		else
		{
			start = true;
		}
	}
	if(start)
	{
		for each  r in records
		{
			vtype_raw = ifnull(r.get("voucher_type"),"").trim();
			vsubtype_raw = ifnull(r.get("voucher_sub_type"),"").trim();
			vtype = vtype_raw.trim().toUpperCase();
			vsubtype = vsubtype_raw.trim().toUpperCase();
			if(vtype == "RECEIPT" && vsubtype == "DEPOSIT")
			{
				header = r;
				voucher_no = ifnull(r.get("voucher_no"),"").trim();
				bill_no = ifnull(r.get("bill_no"),"").trim();
				mr_no = ifnull(r.get("mr_no"),"").trim();
				patient_name = ifnull(header.get("patient_name"),"Unknown Patient");
				voucher_date_str = ifnull(header.get("voucher_date"),"");
				invoice_date = zoho.currentdate.toString("yyyy-MM-dd");
				if(voucher_date_str != null)
				{
					invoice_date = voucher_date_str.toDate("dd-MM-yyyy HH:mm:ss").toString("yyyy-MM-dd");
				}
				searchParams = Map();
				searchParams.put("cf_mr_no",mr_no);
				existingCustomers = zoho.books.getRecords("Customers",organizationID,searchParams,"z_books");
				customer_id = "";
				if(existingCustomers.get("code") == 0 && existingCustomers.get("contacts").size() > 0)
				{
					customer_id = existingCustomers.get("contacts").get(0).get("contact_id");
				}
				else
				{
					new_customer_map = Map();
					new_customer_map.put("contact_name",patient_name);
					new_customer_map.put("customer_type","customer");
					new_customer_map.put("custom_fields",{{"api_name":"cf_mr_no","value":mr_no}});
					create_customer_resp = zoho.books.createRecord("Contacts",organizationID,new_customer_map,"z_books");
					if(create_customer_resp.containKey("contact"))
					{
						customer_id = ifnull(create_customer_resp.get("contact").get("contact_id"),"");
					}
					else
					{
						info "error occured while creating contact: " + create_customer_resp;
						info new_customer_map;
					}
				}
				if(customer_id != "")
				{
					search_payment = Map();
					search_payment.put("reference_number",voucher_no);
					existing_pay = zoho.books.getRecords("customerpayments",organizationID,search_payment,"z_books");
					if(!(existing_pay.containKey("customerpayments") && existing_pay.get("customerpayments").size() > 0))
					{
						payment_map = Map();
						payment_map.put("customer_id",customer_id);
						if(header.get("transaction_type").trim() == "N")
						{
							pmode_raw = ifnull(header.get("debit_account"),"Cash").trim();
						}
						else
						{
							pmode_raw = ifnull(header.get("credit_account"),"Cash").trim();
						}
						if(pmode_raw.length() > 50)
						{
							pmode_raw = "Others";
						}
						payment_map.put("payment_mode",pmode_raw);
						payment_map.put("date",invoice_date);
						payment_map.put("reference_number",voucher_no);
						payment_map.put("amount",ifnull(header.get("net_amount"),0.0));
						deposit_to_id = "";
						if(pmode_raw.containsIgnoreCase("Card"))
						{
							deposit_to_id = "6484579000000986078";
						}
						else if(pmode_raw.containsIgnoreCase("Cash"))
						{
							deposit_to_id = "6484579000000986072";
						}
						else if(pmode_raw.containsIgnoreCase("Online Payment"))
						{
							deposit_to_id = "6484579000000986078";
						}
						else
						{
							deposit_to_id = "6484579000000000358";
						}
						if(header.get("transaction_type").trim() == "N")
						{
							payment_map.put("account_id",deposit_to_id);
							custom_fields_list = list();
							voucher_field = Map();
							voucher_field.put("customfield_id","6484579000002196236");
							voucher_field.put("value",voucher_no);
							custom_fields_list.add(voucher_field);
							bill_field = Map();
							bill_field.put("customfield_id","6484579000002336609");
							bill_field.put("value",bill_no);
							custom_fields_list.add(bill_field);
							payment_map.put("custom_fields",custom_fields_list);
							payment_response = zoho.books.createRecord("customerpayments",organizationID,payment_map,"z_books");
							if(!payment_response.containKey("payment"))
							{
								sendmail
								[
									from :zoho.loginuserid
									to :"manisha@zocoden.com"
									subject :"Deposit creation failure"
									message :"primary_id: " + header.get("primary_id") + " :: " + payment_response + " :: " + payment_map
								]
							}
						}
					}
					else
					{
						if(header.get("transaction_type").trim() == "R")
						{
							// handle for refund
							depositRefund = {"date":invoice_date,"refund_mode":pmode_raw,"reference_number":header.get("voucher_no").trim(),"amount":header.get("net_amount"),"from_account_id":deposit_to_id};
							deprefundProc = invokeurl
							[
								url :"https://www.zohoapis.com/books/v3/customerpayments/" + existing_pay.get("customerpayments").get(0).get("payment_id") + "/refunds?organization_id=" + organizationID
								type :POST
								body:depositRefund.toString()
								connection:"z_books"
							];
							sendmail
							[
								from :zoho.loginuserid
								to :"manisha@zocoden.com"
								subject :"deposit refund"
								message :deprefundProc + " :: " + depositRefund
							]
						}
					}
				}
				else
				{
					info "customer id empty for deposits: " + voucher_no;
					info create_customer_resp;
					info new_customer_map;
				}
			}
			else if(vtype == "RECEIPT" && vsubtype == "DEP SETTLEMENT")
			{
				skip_deps_hb = true;
				header2 = r;
				invoiced_id = "";
				voucher_no = ifnull(header2.get("voucher_no"),"").trim();
				bill_no = ifnull(header2.get("bill_no"),"").trim();
				mr_no = ifnull(header2.get("mr_no"),"").trim();
				patient_name = ifnull(header2.get("patient_name"),"");
				matched_payment = null;
				search_payment_map = Map();
				search_payment_map.put("reference_number",voucher_no);
				existing_payment = zoho.books.getRecords("customerpayments",organizationID,search_payment_map,"z_books");
				if(existing_payment.get("code") == 0 && existing_payment.get("customerpayments").size() > 0)
				{
					for each  pay_rec in existing_payment.get("customerpayments")
					{
						temp_amount = 0.0;
						if(pay_rec.containsKey("unused_amount"))
						{
							temp_amount = ifnull(pay_rec.get("unused_amount"),0.0);
						}
						else if(pay_rec.containsKey("bcy_unused_amount"))
						{
							temp_amount = ifnull(pay_rec.get("bcy_unused_amount"),0.0);
						}
						try 
						{
							temp_amount = temp_amount.toDecimal();
						}
						catch (e)
						{
						}
						// prefer the one with unused balance; fall back to first match
						if(matched_payment == null)
						{
							matched_payment = pay_rec;
						}
						if(temp_amount > 0)
						{
							matched_payment = pay_rec;
							break;
						}
					}
				}
				else
				{
					info "no dep found: " + voucher_no;
				}
				// --- FIX 1: skip if an invoice for this bill_no already exists ---
				// Zoho Books enforces uniqueness on the "Bill No" custom field / reference_number,
				// so re-running this script (or hitting the same bill twice) throws error 120303
				// ("...has been added already") and the settlement never gets recorded.
				already_invoiced = false;
				invoiced_id = "";
				if(bill_no != "")
				{
					search_invoice_dup = Map();
					search_invoice_dup.put("reference_number",bill_no);
					existing_invoice_dup = zoho.books.getRecords("Invoices",organizationID,search_invoice_dup,"z_books");
					if(existing_invoice_dup.get("code") == 0 && existing_invoice_dup.get("invoices").size() > 0)
					{
						info "already invoiced";
						already_invoiced = true;
						invoiced_id = existing_invoice_dup.get("invoices").get(0).get("invoice_id");
						// info "Invoice already exists for Bill No " + bill_no + " - skipping to avoid duplicate.";
					}
				}
				apply_amount = 0.0;
				if(already_invoiced)
				{
					// dep settlement refund, create credit note
					if(header2.get("transaction_type") == "R")
					{
						refunded_amount = refunded_amount + ifnull(header2.get("net_amount"),0.0);
						cli = Map();
						cli.put("name","Deposit Settlement Adjustment - Refund");
						cli.put("rate",ifnull(header2.get("net_amount"),0.0));
						cli.put("quantity",1);
						cli.put("description",header2.get("primary_id").trim() + "/" + header2.get("bill_no").trim() + "/" + header2.get("voucher_no").trim());
						cli.put("account_id","6484579000000098333");
						depcnLineItems.add(cli);
					}
					else
					{
						apply_amount = ifnull(header2.get("net_amount"),0.0);
						li = Map();
						li.put("name","New Deposit Settlement Adjustment");
						li.put("rate",ifnull(header2.get("net_amount"),0.0));
						li.put("quantity",1);
						li.put("description",header2.get("primary_id").trim() + "/" + header2.get("bill_no").trim() + "/" + header2.get("voucher_no").trim());
						li.put("account_id","6484579000000098333");
						dep_line_items.add(li);
					}
				}
				else
				{
					if(header2.get("transaction_type") == "N")
					{
						apply_amount = ifnull(header2.get("net_amount"),0.0);
						// (so they don't have vat_treatment on their contact record yet).
						li = Map();
						li.put("name","Deposit Settlement Adjustment");
						li.put("rate",ifnull(header2.get("net_amount"),0.0));
						li.put("quantity",1);
						li.put("description",header2.get("primary_id").trim() + "/" + header2.get("bill_no").trim() + "/" + header2.get("voucher_no").trim());
						li.put("account_id","6484579000000098333");
						dep_line_items.add(li);
					}
					else if(header2.get("transaction_type") == "R")
					{
						cli = Map();
						cli.put("name","Deposit Settlement Adjustment - Refund");
						cli.put("rate",ifnull(header2.get("net_amount"),0.0));
						cli.put("quantity",1);
						cli.put("description",header2.get("primary_id").trim() + "/" + header2.get("bill_no").trim() + "/" + header2.get("voucher_no").trim());
						cli.put("account_id","6484579000000098333");
						depcnLineItems.add(cli);
					}
				}
				if(matched_payment != null)
				{
					temp_amount = 0.0;
					unapplied_payment_id = "";
					if(matched_payment.containsKey("unused_amount"))
					{
						temp_amount = ifnull(matched_payment.get("unused_amount"),0.0);
					}
					else if(matched_payment.containsKey("bcy_unused_amount"))
					{
						temp_amount = ifnull(matched_payment.get("bcy_unused_amount"),0.0);
					}
					try 
					{
						temp_amount = temp_amount.toDecimal();
					}
					catch (e)
					{
					}
					if(temp_amount > 0)
					{
						unapplied_payment_id = ifnull(matched_payment.get("payment_id"),"");
						if(unapplied_payment_id != "")
						{
							notexists = true;
							for each  recid in payment_id_list
							{
								if(recid.get("pay_id") == unapplied_payment_id)
								{
									temp = recid.get("apply_amount") + apply_amount;
									if(temp <= temp_amount)
									{
										recid.put("apply_amount",recid.get("apply_amount") + apply_amount);
										notexists = false;
										break;
									}
									else
									{
										recid.put("apply_amount",temp_amount);
										notexists = false;
										break;
									}
								}
							}
							if(notexists)
							{
								if(apply_amount <= temp_amount)
								{
									payment_id_list.add({"pay_id":unapplied_payment_id,"apply_amount":apply_amount});
								}
								else
								{
									payment_id_list.add({"pay_id":unapplied_payment_id,"apply_amount":temp_amount});
								}
							}
						}
						// 					unapplied_amount = temp_amount;
						// 					if(header2.get("transaction_type") == "N")
						// 					{
						// 						if(apply_amount <= unapplied_amount)
						// 						{
						// 							dep_apply_amount = apply_amount;
						// 						}
						// 					}
					}
				}
			}
			else
			{
				r_voucher_no = "";
				if(!skip_deps_hb && (vsubtype == "BILL SETTLEMENT" || vsubtype == "BILL ADVANCE") && r.get("transaction_type") == "N")
				{
					has_bill_settlement = true;
				}
				vtype = vtype_raw.trim().toUpperCase();
				if(vtype == "RECEIPT" && r.get("transaction_type") == "N")
				{
					if(skip_deps_hb)
					{
						thisamnt = thisamnt + ifnull(r.get("net_amount"),0.0);
						header3 = r;
						li = Map();
						name = "";
						name = ifnull(r.get("service_name"),ifnull(r.get("item_name"),"Hospital Service")).trim();
						name = name.replaceAll(">","");
						name = name.replaceAll("<","");
						li.put("name",name);
						li.put("rate",ifnull(r.get("net_amount"),0.0));
						li.put("discount",ifnull(r.get("discount_amount"),0.0));
						// li.put("quantity",ifnull(header.get("quantity"),1));
						li.put("quantity",1);
						li.put("description",r.get("primary_id").trim() + "/" + r.get("bill_no").trim() + "/" + r.get("voucher_no").trim());
						li.put("account_id","6484579000000098333");
						dep_come_bill_line_items.add(li);
					}
					else
					{
						header = r;
						department = ifnull(r.get("admitting_department"),"").trim();
						doctor = ifnull(r.get("admitting_doctor"),"").trim();
						r_payment_mode = ifnull(r.get("debit_account"),"Cash").trim();
						r_total_amount = r_total_amount + ifnull(r.get("net_amount"),0.0);
						r_voucher_no = ifnull(r.get("voucher_no"),"").trim();
						r_bill_no = ifnull(r.get("bill_no"),"").trim();
					}
				}
				else if(!skip_deps_hb && vtype == "HOSPBILLS")
				{
					header = r;
					voucher_no = ifnull(header.get("voucher_no"),"").trim();
					bill_no = ifnull(header.get("bill_no"),"").trim();
					if(header.get("transaction_type") == "N")
					{
						if(ifnull(header.get("debit_account"),"").trim() == "Discounts")
						{
							amt = ifnull(header.get("custom_1"),0.0);
							total_amount = total_amount + amt.toDecimal();
							total_discount = total_discount + ifnull(header.get("discount_amount"),0.0);
							li = Map();
							li.put("name","Discounts");
							li.put("rate",amt.toDecimal());
							li.put("discount",ifnull(header.get("discount_amount"),0.0));
							// li.put("quantity",ifnull(header.get("quantity"),1));
							li.put("quantity",1);
							li.put("description",header.get("primary_id").trim() + "/" + header.get("bill_no").trim() + "/" + header.get("voucher_no").trim());
							li.put("account_id","6484579000000098333");
							line_items.add(li);
						}
						else
						{
							amt = ifnull(header.get("gross_amount"),0.0);
							total_amount = total_amount + amt;
							total_discount = total_discount + ifnull(header.get("discount_amount"),0.0);
							li = Map();
							name = "";
							name = ifnull(header.get("service_name"),ifnull(header.get("item_name"),"Hospital Service")).trim();
							name = name.replaceAll(">","");
							name = name.replaceAll("<","");
							li.put("name",name);
							li.put("rate",amt);
							li.put("discount",ifnull(header.get("discount_amount"),0.0));
							// li.put("quantity",ifnull(header.get("quantity"),1));
							li.put("quantity",1);
							li.put("description",header.get("primary_id").trim() + "/" + header.get("bill_no").trim() + "/" + header.get("voucher_no").trim());
							li.put("account_id","6484579000000098333");
							line_items.add(li);
						}
					}
					else if(header.get("transaction_type") == "R")
					{
						// create credit note
						cnMap = Map();
						name = "";
						name = ifnull(header.get("service_name"),ifnull(header.get("item_name"),"Hospital Service")).trim();
						name = name.replaceAll(">","");
						name = name.replaceAll("<","");
						cnMap.put("name",name);
						// cnMap.put("quantity",ifnull(header.get("quantity"),1));
						cnMap.put("quantity",1);
						cnMap.put("rate",ifnull(header.get("gross_amount"),0.0));
						cnMap.put("discount",ifnull(header.get("discount_amount"),0.0));
						cnMap.put("description",header.get("primary_id").trim() + "/" + header.get("bill_no").trim() + "/" + header.get("voucher_no").trim());
						cnMap.put("account_id","6484579000000098333");
						cnLineItems.add(cnMap);
					}
				}
				else if(vtype == "PAYMENT" && vsubtype == "BILL REFUND")
				{
					if(r_total_amount > r.get("net_amount") && r_total_amount != r.get("net_amount"))
					{
						info "iff billl refund";
						r_total_amount = r_total_amount - r.get("net_amount");
						voucher_no = ifnull(r.get("voucher_no"),"").trim();
						bill_no = ifnull(r.get("bill_no"),"").trim();
						// create credit note
						cnMap = Map();
						name = "";
						name = ifnull(r.get("service_name"),ifnull(r.get("item_name"),"Hospital Service")).trim();
						name = name.replaceAll(">","");
						name = name.replaceAll("<","");
						cnMap.put("name",name);
						// cnMap.put("quantity",ifnull(header.get("quantity"),1));
						cnMap.put("quantity",1);
						cnMap.put("rate",ifnull(r.get("gross_amount"),0.0));
						cnMap.put("discount",ifnull(r.get("discount_amount"),0.0));
						cnMap.put("description",r.get("primary_id").trim() + "/" + r.get("bill_no").trim() + "/" + r.get("voucher_no").trim());
						cnMap.put("account_id","6484579000000098333");
						cnLineItems.add(cnMap);
					}
					else
					{
						voucher_no = ifnull(r.get("voucher_no"),"").trim();
						bill_no = ifnull(r.get("bill_no"),"").trim();
						// create credit note
						cnMap = Map();
						name = "";
						name = ifnull(r.get("service_name"),ifnull(r.get("item_name"),"Hospital Service")).trim();
						name = name.replaceAll(">","");
						name = name.replaceAll("<","");
						cnMap.put("name",name);
						// cnMap.put("quantity",ifnull(header.get("quantity"),1));
						cnMap.put("quantity",1);
						cnMap.put("rate",ifnull(r.get("gross_amount"),0.0));
						cnMap.put("discount",ifnull(r.get("discount_amount"),0.0));
						cnMap.put("description",r.get("primary_id").trim() + "/" + r.get("bill_no").trim() + "/" + r.get("voucher_no").trim());
						cnMap.put("account_id","6484579000000098333");
						cnLineItems.add(cnMap);
					}
				}
			}
		}
	}
	if(header != null)
	{
		voucher_no = ifnull(header.get("voucher_no"),"").trim();
		bill_no = ifnull(header.get("bill_no"),"").trim();
		mr_no = ifnull(header.get("mr_no"),"").trim();
		patient_name = ifnull(header.get("patient_name"),"Unknown Patient");
		voucher_date_str = header.get("voucher_date");
		invoice_date = zoho.currentdate.toString("yyyy-MM-dd");
		// info "===============================> 12" + patient_name; 
		if(voucher_date_str != null)
		{
			invoice_date = voucher_date_str.toDate("dd-MM-yyyy HH:mm:ss").toString("yyyy-MM-dd");
		}
		searchParams = Map();
		searchParams.put("cf_mr_no",mr_no);
		existingCustomers = zoho.books.getRecords("Customers",organizationID,searchParams,"z_books");
		customer_id = "";
		if(existingCustomers.get("code") == 0 && existingCustomers.get("contacts").size() > 0)
		{
			customer_id = existingCustomers.get("contacts").get(0).get("contact_id");
		}
		else
		{
			new_customer_map = Map();
			new_customer_map.put("contact_name",patient_name);
			new_customer_map.put("customer_type","customer");
			new_customer_map.put("custom_fields",{{"api_name":"cf_mr_no","value":mr_no}});
			create_customer_resp = zoho.books.createRecord("Contacts",organizationID,new_customer_map,"z_books");
			if(create_customer_resp.containKey("contact"))
			{
				customer_id = ifnull(create_customer_resp.get("contact").get("contact_id"),"");
			}
			else
			{
				sendmail
				[
					from :zoho.loginuserid
					to :"manisha@zocoden.com"
					subject :"error occured while creating contact"
					message :create_customer_resp + " :: " + new_customer_map
				]
			}
		}
		if(customer_id != "")
		{
			search_invoice_map = Map();
			search_invoice_map.put("reference_number",bill_no);
			existingInvoice = zoho.books.getRecords("Invoices",organizationID,search_invoice_map,"z_books");
			proceed = true;
			if(proceed)
			{
				if(line_items.size() > 0)
				{
					if(existingInvoice.containKey("invoices") && existingInvoice.get("invoices").size() == 0)
					{
						invoice_data = Map();
						invoice_data.put("customer_id",customer_id);
						invoice_data.put("date",invoice_date);
						invoice_data.put("line_items",line_items);
						invoice_data.put("reference_number",bkey);
						custom_fields_list = list();
						dept_field = Map();
						dept_field.put("customfield_id","6484579000000895003");
						dept_field.put("value",department);
						custom_fields_list.add(dept_field);
						doc_field = Map();
						doc_field.put("customfield_id","6484579000000383621");
						doc_field.put("value",doctor);
						custom_fields_list.add(doc_field);
						voucher_field = Map();
						voucher_field.put("customfield_id","6484579000002196232");
						voucher_field.put("value",voucher_no);
						custom_fields_list.add(voucher_field);
						bill_field = Map();
						bill_field.put("customfield_id","6484579000002336604");
						bill_field.put("value",bill_no);
						custom_fields_list.add(bill_field);
						invoice_data.put("custom_fields",custom_fields_list);
						invoice_data.put("tax_treatment","dz_vat_registered");
						invoice_data.put("place_of_supply","DU");
						contact_update = Map();
						contact_update.put("country","United Arab Emirates");
						// Try one of the UAE tax treatments
						contact_update.put("gcc_vat_treatment","consumer");
						resp = zoho.books.updateRecord("Contacts",organizationID,customer_id,contact_update,"z_books");
						contact_resp = zoho.books.getRecordsByID("Contacts",organizationID,customer_id,"z_books");
						create_response = zoho.books.createRecord("Invoices",organizationID,invoice_data,"z_books");
						// info "create_response:: " + create_response;
						if(create_response.containKey("invoice") && create_response.get("invoice").get("invoice_id"))
						{
							if(has_bill_settlement)
							{
								info "has_bill_settlement: " + r_bill_no;
								invoice_id = create_response.get("invoice").get("invoice_id");
								payment_map = Map();
								payment_map.put("customer_id",customer_id);
								// payment_mode = ifnull(header.get("debit_account"),"Cash").trim();
								payment_map.put("payment_mode",r_payment_mode);
								total_amount = total_amount - total_discount;
								if(r_total_amount < total_amount)
								{
									payment_map.put("amount",total_amount);
								}
								else
								{
									payment_map.put("amount",r_total_amount);
								}
								payment_map.put("date",invoice_date);
								deposit_to_id = "";
								if(r_payment_mode.containsIgnoreCase("Card"))
								{
									deposit_to_id = "6484579000000986078";
								}
								else if(r_payment_mode.containsIgnoreCase("Cash"))
								{
									deposit_to_id = "6484579000000986072";
								}
								else if(r_payment_mode.containsIgnoreCase("Petty"))
								{
									// 	deposit_to_id = "6484579000000000361";
								}
								else if(r_payment_mode.containsIgnoreCase("Online Payment"))
								{
									deposit_to_id = "6484579000000986078";
								}
								else
								{
									deposit_to_id = "6484579000000000358";
								}
								payment_map.put("account_id",deposit_to_id);
								invoice_payment = Map();
								invoice_payment.put("invoice_id",invoice_id);
								invoice_payment.put("amount_applied",total_amount);
								invoices_list = list();
								invoices_list.add(invoice_payment);
								payment_map.put("invoices",invoices_list);
								custom_fields_list = list();
								voucher_field = Map();
								voucher_field.put("customfield_id","6484579000002196236");
								voucher_field.put("value",r_voucher_no);
								custom_fields_list.add(voucher_field);
								bill_field = Map();
								bill_field.put("customfield_id","6484579000002336609");
								bill_field.put("value",r_bill_no);
								custom_fields_list.add(bill_field);
								payment_map.put("custom_fields",custom_fields_list);
								payment_response = zoho.books.createRecord("customerpayments",organizationID,payment_map,"z_books");
								if(!payment_response.containKey("payment"))
								{
									sendmail
									[
										from :zoho.loginuserid
										to :"manisha@zocoden.com"
										subject :"payment_response"
										message :payment_response + " :: " + payment_map
									]
								}
								else
								{
									if(cnLineItems.size() > 0)
									{
										// credit note
										creditNt = Map();
										creditNt.put("customer_id",customer_id);
										creditNt.put("date",invoice_date);
										creditNt.put("reference_number",header.get("voucher_no").trim() + "/" + header.get("bill_no").trim());
										creditNt.put("place_of_supply",create_response.get("invoice").get("place_of_supply"));
										allVnos = list();
										for each  itm in cnLineItems
										{
											itm.put("invoice_id",invoice_id);
										}
										creditNt.put("line_items",cnLineItems);
										creditCreate = zoho.books.createRecord("creditnotes",organizationID,creditNt,"z_books");
										if(creditCreate.containKey("creditnote"))
										{
											cdn_ref = Map();
											cdn_ref.put("date",invoice_date);
											cdn_ref.put("amount",creditCreate.get("creditnote").get("total"));
											cdn_ref.put("from_account_id",deposit_to_id);
											refundcreditn = invokeurl
											[
												url :"https://www.zohoapis.com/books/v3/creditnotes/" + creditCreate.get("creditnote").get("creditnote_id") + "/refunds?organization_id=" + organizationID
												type :POST
												body:cdn_ref.toString()
												headers:{"content-type":"application/json"}
												connection:"z_books"
											];
											info "inv credit note refund " + refundcreditn;
											info cdn_ref;
											info creditCreate.get("creditnote").get("creditnote_id");
										}
										else
										{
											sendmail
											[
												from :zoho.loginuserid
												to :"manisha@zocoden.com"
												subject :"credit note not created"
												message :creditCreate + " :: " + creditNt
											]
										}
									}
								}
							}
							else
							{
								info bill_no + " :no bill: " + create_response.get("invoice").get("invoice_id");
							}
						}
						else
						{
							sendmail
							[
								from :zoho.loginuserid
								to :"manisha@zocoden.com"
								subject :"failure create_response:"
								message :create_response + " :: " + invoice_data
							]
						}
					}
					else
					{
						info "invoice exists: " + bkey;
						getinvoice = existingInvoice.get("invoices").get(0);
						if(getinvoice.get("status") == "draft")
						{
							getOldInv = zoho.books.getRecordsByID("invoices",organizationID,getinvoice.get("invoice_id"),"z_books");
							line_items.addAll(getOldInv.get("invoice").get("line_items"));
							updateInv = Map();
							updateInv.put("line_items",line_items);
							updateOldInv = zoho.books.updateRecord("invoices",organizationID,getinvoice.get("invoice_id"),updateInv,"z_books");
							if(updateOldInv.containKey("invoice"))
							{
								if(has_bill_settlement)
								{
									invoice_id = getinvoice.get("invoice_id");
									payment_map = Map();
									payment_map.put("customer_id",customer_id);
									// payment_mode = ifnull(header.get("debit_account"),"Cash").trim();
									payment_map.put("payment_mode",r_payment_mode);
									total_amount = total_amount - total_discount;
									if(r_total_amount < total_amount)
									{
										payment_map.put("amount",total_amount);
									}
									else
									{
										payment_map.put("amount",r_total_amount);
									}
									payment_map.put("date",invoice_date);
									deposit_to_id = "";
									if(r_payment_mode.containsIgnoreCase("Card"))
									{
										deposit_to_id = "6484579000000986078";
									}
									else if(r_payment_mode.containsIgnoreCase("Cash"))
									{
										deposit_to_id = "6484579000000986072";
									}
									else if(r_payment_mode.containsIgnoreCase("Petty"))
									{
										// 	deposit_to_id = "6484579000000000361";
									}
									else if(r_payment_mode.containsIgnoreCase("Online Payment"))
									{
										deposit_to_id = "6484579000000986078";
									}
									else
									{
										deposit_to_id = "6484579000000000358";
									}
									payment_map.put("account_id",deposit_to_id);
									invoice_payment = Map();
									invoice_payment.put("invoice_id",invoice_id);
									invoice_payment.put("amount_applied",total_amount);
									invoices_list = list();
									invoices_list.add(invoice_payment);
									payment_map.put("invoices",invoices_list);
									custom_fields_list = list();
									voucher_field = Map();
									voucher_field.put("customfield_id","6484579000002196236");
									voucher_field.put("value",r_voucher_no);
									custom_fields_list.add(voucher_field);
									bill_field = Map();
									bill_field.put("customfield_id","6484579000002336609");
									bill_field.put("value",r_bill_no);
									custom_fields_list.add(bill_field);
									payment_map.put("custom_fields",custom_fields_list);
									payment_response = zoho.books.createRecord("customerpayments",organizationID,payment_map,"z_books");
									if(!payment_response.containKey("payment"))
									{
										sendmail
										[
											from :zoho.loginuserid
											to :"manisha@zocoden.com"
											subject :"payment_response 3:"
											message :payment_response + " :: " + payment_map
										]
									}
								}
							}
							else
							{
								sendmail
								[
									from :zoho.loginuserid
									to :"manisha@zocoden.com"
									subject :"update invoice failed"
									message :getinvoice.get("invoice_id") + " :: " + updateInv + " :: " + updateOldInv
								]
							}
						}
					}
				}
			}
			if(line_items.size() == 0 && has_bill_settlement)
			{
				// invoice exists, handle payment
				if(existingInvoice.containKey("invoices") && existingInvoice.get("invoices").size() > 0)
				{
					invoice_id = existingInvoice.get("invoices").get(0).get("invoice_id");
					payment_map = Map();
					payment_map.put("customer_id",customer_id);
					// payment_mode = ifnull(header.get("debit_account"),"Cash").trim();
					payment_map.put("payment_mode",r_payment_mode);
					payment_map.put("amount",r_total_amount);
					payment_map.put("date",invoice_date);
					deposit_to_id = "";
					if(r_payment_mode.containsIgnoreCase("Card"))
					{
						deposit_to_id = "6484579000000986078";
					}
					else if(r_payment_mode.containsIgnoreCase("Cash"))
					{
						deposit_to_id = "6484579000000986072";
					}
					else if(r_payment_mode.containsIgnoreCase("Petty"))
					{
						// 	deposit_to_id = "6484579000000000361";
					}
					else if(r_payment_mode.containsIgnoreCase("Online Payment"))
					{
						deposit_to_id = "6484579000000986078";
					}
					else
					{
						deposit_to_id = "6484579000000000358";
					}
					payment_map.put("account_id",deposit_to_id);
					invoice_payment = Map();
					invoice_payment.put("invoice_id",invoice_id);
					invoice_payment.put("amount_applied",r_total_amount);
					invoices_list = list();
					invoices_list.add(invoice_payment);
					payment_map.put("invoices",invoices_list);
					custom_fields_list = list();
					voucher_field = Map();
					voucher_field.put("customfield_id","6484579000002196236");
					voucher_field.put("value",r_voucher_no);
					custom_fields_list.add(voucher_field);
					bill_field = Map();
					bill_field.put("customfield_id","6484579000002336609");
					bill_field.put("value",r_bill_no);
					custom_fields_list.add(bill_field);
					payment_map.put("custom_fields",custom_fields_list);
					payment_response = zoho.books.createRecord("customerpayments",organizationID,payment_map,"z_books");
					if(!payment_response.containKey("payment"))
					{
						info "payment_response: " + payment_response;
						info payment_map;
						info "4-----------------------------4";
						sendmail
						[
							from :zoho.loginuserid
							to :"manisha@zocoden.com"
							subject :"payment_response 4"
							message :payment_response + " :: " + payment_map
						]
					}
					else
					{
						if(cnLineItems.size() > 0)
						{
							// credit note
							creditNt = Map();
							creditNt.put("customer_id",customer_id);
							creditNt.put("date",invoice_date);
							creditNt.put("reference_number",header.get("voucher_no").trim() + "/" + header.get("bill_no").trim());
							creditNt.put("place_of_supply",create_response.get("invoice").get("place_of_supply"));
							allVnos = list();
							for each  itm in cnLineItems
							{
								itm.put("invoice_id",invoice_id);
							}
							creditNt.put("line_items",cnLineItems);
							creditCreate = zoho.books.createRecord("creditnotes",organizationID,creditNt,"z_books");
							if(creditCreate.containKey("creditnote"))
							{
								cdn_ref = Map();
								cdn_ref.put("date",invoice_date);
								cdn_ref.put("amount",creditCreate.get("creditnote").get("total"));
								cdn_ref.put("from_account_id",deposit_to_id);
								refundcreditn = invokeurl
								[
									url :"https://www.zohoapis.com/books/v3/creditnotes/" + creditCreate.get("creditnote").get("creditnote_id") + "/refunds?organization_id=" + organizationID
									type :POST
									body:cdn_ref.toString()
									headers:{"content-type":"application/json"}
									connection:"z_books"
								];
								info "inv credit note refund " + refundcreditn;
								info cdn_ref;
								info creditCreate.get("creditnote").get("creditnote_id");
							}
							else
							{
								sendmail
								[
									from :zoho.loginuserid
									to :"manisha@zocoden.com"
									subject :"credit note not created"
									message :creditCreate + " :: " + creditNt
								]
							}
						}
					}
				}
			}
		}
		else
		{
			sendmail
			[
				from :zoho.loginuserid
				to :"manisha@zocoden.com"
				subject :"customer id empty invoice:" + voucher_no
				message :create_customer_resp + " :: " + new_customer_map
			]
		}
	}
	if(!has_bill_settlement && cnLineItems.size() > 0)
	{
		// if(cnLineItems.size() > 0)
		info "cnLineItems: " + bkey;
		patient_name = ifnull(r.get("patient_name"),"Unknown Patient");
		mr_no = ifnull(r.get("mr_no")," ").trim();
		voucher_date_str = r.get("voucher_date");
		invoice_date = zoho.currentdate.toString("yyyy-MM-dd");
		// info "===============================> 12" + patient_name; 
		if(voucher_date_str != null)
		{
			invoice_date = voucher_date_str.toDate("dd-MM-yyyy HH:mm:ss").toString("yyyy-MM-dd");
		}
		searchParams = Map();
		searchParams.put("cf_mr_no",mr_no);
		existingCustomers = zoho.books.getRecords("Customers",organizationID,searchParams,"z_books");
		customer_id = "";
		if(existingCustomers.get("code") == 0 && existingCustomers.get("contacts").size() > 0)
		{
			customer_id = existingCustomers.get("contacts").get(0).get("contact_id");
		}
		else
		{
			new_customer_map = Map();
			new_customer_map.put("contact_name",patient_name);
			new_customer_map.put("customer_type","customer");
			new_customer_map.put("custom_fields",{{"api_name":"cf_mr_no","value":mr_no}});
			create_customer_resp = zoho.books.createRecord("Contacts",organizationID,new_customer_map,"z_books");
			if(create_customer_resp.containKey("contact"))
			{
				customer_id = ifnull(create_customer_resp.get("contact").get("contact_id"),"");
			}
			else
			{
				info "error occured while creating contact: " + create_customer_resp;
				info new_customer_map;
			}
		}
		if(customer_id != "")
		{
			smap = Map();
			smap.put("reference_number",bkey);
			searchInv = zoho.books.getRecords("invoices",organizationID,smap,"z_books");
			if(searchInv.containKey("invoices") && searchInv.get("invoices").size() > 0)
			{
				invoice_id = searchInv.get("invoices").get(0).get("invoice_id");
				getpc1 = zoho.books.getRecordsByID("Invoices",organizationID,invoice_id,"z_books");
				// credit note
				creditNt = Map();
				creditNt.put("customer_id",customer_id);
				creditNt.put("date",invoice_date);
				creditNt.put("reference_number",r.get("voucher_no").trim() + "/" + r.get("bill_no").trim());
				creditNt.put("place_of_supply",getpc1.get("invoice").get("place_of_supply"));
				for each  itm in cnLineItems
				{
					itm.put("invoice_id",invoice_id);
				}
				creditNt.put("line_items",cnLineItems);
				creditCreate = zoho.books.createRecord("creditnotes",organizationID,creditNt,"z_books");
				if(creditCreate.containKey("creditnote"))
				{
					cn_ref = Map();
					cn_ref.put("date",invoice_date);
					cn_ref.put("amount",creditCreate.get("creditnote").get("total"));
					searchAcntid = zoho.books.getRecords("customerpayments",organizationID,{"reference_number":bkey},"z_books");
					if(searchAcntid.containKey("customerpayments") && searchAcntid.get("customerpayments").size() > 0)
					{
						cn_ref.put("from_account_id",searchAcntid.get("customerpayments").get(0).get("account_id"));
						refundcreditn = invokeurl
						[
							url :"https://www.zohoapis.com/books/v3/creditnotes/" + creditCreate.get("creditnote").get("creditnote_id") + "/refunds?organization_id=" + organizationID
							type :POST
							body:cn_ref.toString()
							headers:{"content-type":"application/json"}
							connection:"z_books"
						];
						sendmail
						[
							from :zoho.loginuserid
							to :"manisha@zocoden.com"
							subject :"single Credit note refund response"
							message :"credit note id" + creditCreate.get("creditnote").get("creditnote_id") + " :: " + refundcreditn
						]
					}
				}
				else
				{
					sendmail
					[
						from :zoho.loginuserid
						to :"manisha@zocoden.com"
						subject :"Credit note failure"
						message :creditCreate + " :: " + creditNt
					]
				}
			}
			else
			{
				info "invoice not exists : " + bkey;
			}
		}
		else
		{
			info "customer id empty for credit note";
			info create_customer_resp;
			info new_customer_map;
		}
	}
	if(header2 != null)
	{
		info "header2";
		voucher_no = ifnull(header2.get("voucher_no"),"").trim();
		bill_no = ifnull(header2.get("bill_no"),"").trim();
		mr_no = ifnull(header2.get("mr_no"),"").trim();
		patient_name = ifnull(header2.get("patient_name"),"Unknown Patient");
		voucher_date_str = header2.get("voucher_date");
		invoice_date = zoho.currentdate.toString("yyyy-MM-dd");
		// info "===============================> 12" + patient_name; 
		if(voucher_date_str != null)
		{
			invoice_date = voucher_date_str.toDate("dd-MM-yyyy HH:mm:ss").toString("yyyy-MM-dd");
		}
		searchParams = Map();
		searchParams.put("cf_mr_no",mr_no);
		existingCustomers = zoho.books.getRecords("Customers",organizationID,searchParams,"z_books");
		customer_id = "";
		if(existingCustomers.get("code") == 0 && existingCustomers.get("contacts").size() > 0)
		{
			customer_id = existingCustomers.get("contacts").get(0).get("contact_id");
		}
		else
		{
			new_customer_map = Map();
			new_customer_map.put("contact_name",patient_name);
			new_customer_map.put("customer_type","customer");
			new_customer_map.put("custom_fields",{{"api_name":"cf_mr_no","value":mr_no}});
			create_customer_resp = zoho.books.createRecord("Contacts",organizationID,new_customer_map,"z_books");
			if(create_customer_resp.containKey("contact"))
			{
				customer_id = ifnull(create_customer_resp.get("contact").get("contact_id"),"");
			}
			else
			{
				info "error occured while creating contact: " + create_customer_resp;
				info new_customer_map;
			}
		}
		if(customer_id != "")
		{
			paymentfound = false;
			search_invoice_map = Map();
			search_invoice_map.put("reference_number",bkey);
			// existingInvoice = zoho.books.getRecords("Invoices",organizationID,search_invoice_map,"z_books");
			proceed1 = true;
			if(proceed1)
			{
				if(dep_line_items.size() > 0)
				{
					if(depcnLineItems.size() > 0)
					{
						// handle refunded amounts in line item
						temprate = "-" + refunded_amount;
						li = Map();
						li.put("name","Deposit Settlement - Refund");
						li.put("rate",temprate);
						li.put("quantity",1);
						li.put("account_id","6484579000000098333");
						dep_line_items.add(li);
					}
					info "unapplied_payment_id: " + unapplied_payment_id;
					if(payment_id_list.size() > 0)
					{
						if(!already_invoiced)
						{
							info "not invoied, new";
							// create new dep settlement
							invoice_data = Map();
							invoice_data.put("tax_treatment","dz_vat_registered");
							invoice_data.put("place_of_supply","DU");
							invoice_data.put("customer_id",customer_id);
							invoice_data.put("date",invoice_date);
							invoice_data.put("reference_number",bill_no);
							if(dep_come_bill_line_items.size() > 0)
							{
								dep_line_items.addAll(dep_come_bill_line_items);
							}
							invoice_data.put("line_items",dep_line_items);
							custom_fields_list = list();
							voucher_field = Map();
							voucher_field.put("customfield_id","6484579000002196232");
							voucher_field.put("value",voucher_no);
							custom_fields_list.add(voucher_field);
							bill_field = Map();
							bill_field.put("customfield_id","6484579000002336604");
							bill_field.put("value",bill_no);
							custom_fields_list.add(bill_field);
							invoice_data.put("custom_fields",custom_fields_list);
							create_invoice_resp = zoho.books.createRecord("Invoices",organizationID,invoice_data,"z_books");
							// info "Create Invoice Response: " + create_invoice_resp;
							if(create_invoice_resp.containKey("invoice"))
							{
								invoice_id = ifnull(create_invoice_resp.get("invoice").get("invoice_id"),"");
								if(invoice_id != "")
								{
									for each  ids in payment_id_list
									{
										info "invoice id found";
										apply_map = Map();
										invoice_ref = Map();
										invoice_ref.put("invoice_id",invoice_id);
										invoice_ref.put("amount_applied",ids.get("apply_amount"));
										invoices_list = list();
										invoices_list.add(invoice_ref);
										apply_map.put("invoices",invoices_list);
										update_resp = zoho.books.updateRecord("customerpayments",organizationID,ids.get("pay_id"),apply_map,"z_books");
										info apply_map;
										if(!update_resp.containKey("payment"))
										{
											sendmail
											[
												from :zoho.loginuserid
												to :"manisha@zocoden.com"
												subject :"update_resp"
												message :unapplied_payment_id + " :: " + apply_map + " :: " + update_resp
											]
										}
										else
										{
											paymentfound = true;
										}
									}
									if(paymentfound)
									{
										if(depcnLineItems.size() > 0)
										{
											getpc1 = zoho.books.getRecordsByID("Invoices",organizationID,invoice_id,"z_books");
											creditNt = Map();
											creditNt.put("customer_id",customer_id);
											creditNt.put("date",invoice_date);
											creditNt.put("reference_number",header2.get("voucher_no").trim() + "/" + header2.get("bill_no").trim());
											creditNt.put("place_of_supply",getpc1.get("invoice").get("place_of_supply"));
											for each  itm in depcnLineItems
											{
												itm.put("invoice_id",invoice_id);
											}
											creditNt.put("line_items",depcnLineItems);
											creditCreate = zoho.books.createRecord("creditnotes",organizationID,creditNt,"z_books");
											if(creditCreate.containKey("creditnote"))
											{
												cn_ref = Map();
												cn_ref.put("date",invoice_date);
												cn_ref.put("amount",creditCreate.get("creditnote").get("total"));
												searchAcntid = zoho.books.getRecords("customerpayments",organizationID,{"reference_number":voucher_no},"z_books");
												if(searchAcntid.containKey("customerpayments") && searchAcntid.get("customerpayments").size() > 0)
												{
													cn_ref.put("from_account_id",searchAcntid.get("customerpayments").get(0).get("account_id"));
													refundcreditn = invokeurl
													[
														url :"https://www.zohoapis.com/books/v3/creditnotes/" + creditCreate.get("creditnote").get("creditnote_id") + "/refunds?organization_id=" + organizationID
														type :POST
														body:cn_ref.toString()
														headers:{"content-type":"application/json"}
														connection:"z_books"
													];
													sendmail
													[
														from :zoho.loginuserid
														to :"manisha@zocoden.com"
														subject :"single 1 Credit note refund response"
														message :"credit note id" + creditCreate.get("creditnote").get("creditnote_id") + " :: " + refundcreditn
													]
												}
											}
											else
											{
												sendmail
												[
													from :zoho.loginuserid
													to :"manisha@zocoden.com"
													subject :"Credit note failure"
													message :creditCreate + " :: " + creditNt
												]
											}
										}
									}
								}
								if(dep_come_bill_line_items.size() > 0)
								{
									// create payment
									payment_map = Map();
									payment_map.put("customer_id",customer_id);
									payment_mode = ifnull(header3.get("debit_account"),"Cash").trim();
									payment_map.put("payment_mode",payment_mode);
									payment_map.put("amount",thisamnt);
									payment_map.put("date",invoice_date);
									deposit_to_id = "";
									if(payment_mode.containsIgnoreCase("Card"))
									{
										deposit_to_id = "6484579000000986078";
									}
									else if(payment_mode.containsIgnoreCase("Cash"))
									{
										deposit_to_id = "6484579000000986072";
									}
									else if(payment_mode.containsIgnoreCase("Petty"))
									{
										// 	deposit_to_id = "6484579000000000361";
									}
									else if(payment_mode.containsIgnoreCase("Online Payment"))
									{
										deposit_to_id = "6484579000000986078";
									}
									else
									{
										deposit_to_id = "6484579000000000358";
									}
									payment_map.put("account_id",deposit_to_id);
									invoice_payment = Map();
									invoice_payment.put("invoice_id",invoice_id);
									invoice_payment.put("amount_applied",thisamnt);
									invoices_list = list();
									invoices_list.add(invoice_payment);
									payment_map.put("invoices",invoices_list);
									custom_fields_list = list();
									voucher_field = Map();
									voucher_field.put("customfield_id","6484579000002196236");
									voucher_field.put("value",ifnull(header3.get("voucher_no"),"").trim());
									custom_fields_list.add(voucher_field);
									bill_field = Map();
									bill_field.put("customfield_id","6484579000002336609");
									bill_field.put("value",ifnull(header3.get("bill_no"),"").trim());
									custom_fields_list.add(bill_field);
									payment_map.put("custom_fields",custom_fields_list);
									payment_response = zoho.books.createRecord("customerpayments",organizationID,payment_map,"z_books");
									if(!payment_response.containKey("payment"))
									{
										sendmail
										[
											from :zoho.loginuserid
											to :"manisha@zocoden.com"
											subject :"payment_response for bill dep: "
											message :payment_response + " :: " + payment_map
										]
									}
								}
							}
							else
							{
								sendmail
								[
									from :zoho.loginuserid
									to :"manisha@zocoden.com"
									subject :"dep settlement not created "
									message :create_invoice_resp + " :: " + invoice_data
								]
							}
						}
						else
						{
							// invoice exists adjust line items
							info "invoice exists adjust line items: " + bkey;
							getOldInv = zoho.books.getRecordsByID("invoices",organizationID,invoiced_id,"z_books");
							dep_line_items.addAll(getOldInv.get("invoice").get("line_items"));
							old_ln_itms = getOldInv.get("invoice").get("line_items");
							olddescriptions = list();
							for each  des in old_ln_itms
							{
								olddescriptions.add(des.get("description"));
							}
							for each  newitem in dep_line_items
							{
								if(olddescriptions.contains(newitem.get("description")))
								{
									dep_line_items.removeElement(newitem);
								}
							}
							if(dep_line_items.size() > 0)
							{
								updateInv = Map();
								updateInv.put("reason","New Dep settlement received for this Bill No: Voucher no is: " + voucher_no);
								if(dep_come_bill_line_items.size() > 0)
								{
									olddescriptions = list();
									for each  des in old_ln_itms
									{
										olddescriptions.add(des.get("description"));
									}
									for each  newitem in dep_come_bill_line_items
									{
										if(olddescriptions.contains(newitem.get("description")))
										{
											dep_come_bill_line_items.removeElement(newitem);
										}
									}
									if(dep_come_bill_line_items.size() > 0)
									{
										dep_line_items.addAll(dep_come_bill_line_items);
									}
								}
								updateInv.put("line_items",dep_line_items);
								updateOldInv = zoho.books.updateRecord("invoices",organizationID,invoiced_id,updateInv,"z_books");
								if(updateOldInv.containKey("invoice"))
								{
									for each  ids in payment_id_list
									{
										// apply for amount
										apply_map = Map();
										invoice_ref = Map();
										invoice_ref.put("invoice_id",invoiced_id);
										invoice_ref.put("amount_applied",ids.get("apply_amount"));
										invoices_list = list();
										invoices_list.add(invoice_ref);
										apply_map.put("invoices",invoices_list);
										update_resp = zoho.books.updateRecord("customerpayments",organizationID,ids.get("pay_id"),apply_map,"z_books");
									}
								}
								else
								{
									sendmail
									[
										from :zoho.loginuserid
										to :"manisha@zocoden.com"
										subject :"update invoice failed 2 "
										message :getinvoice.get("invoice_id") + " :: " + updateInv + " :: " + updateOldInv
									]
								}
							}
						}
					}
					else
					{
						info "deposit rec id not found: " + bkey;
					}
				}
				if(dep_line_items.size() == 0 && depcnLineItems.size() > 0)
				{
					info "no line items";
					getpc = zoho.books.getRecordsByID("Invoices",organizationID,invoiced_id,"z_books");
					for each  itm in depcnLineItems
					{
						itm.put("invoice_id",invoiced_id);
					}
					credit = {"customer_id":customer_id,"date":invoice_date,"place_of_supply":getpc.get("invoice").get("place_of_supply"),"line_items":depcnLineItems};
					creditCreate = zoho.books.createRecord("creditnotes",organizationID,credit,"z_books");
					if(creditCreate.containKey("creditnote"))
					{
						cn_ref = Map();
						cn_ref.put("date",invoice_date);
						cn_ref.put("amount",creditCreate.get("creditnote").get("total"));
						cn_ref.put("from_account_id","6484579000000098333");
						refun = invokeurl
						[
							url :"https://www.zohoapis.com/books/v3/creditnotes/" + creditCreate.get("creditnote").get("creditnote_id") + "/refunds?organization_id=" + organizationID
							type :POST
							body:cn_ref.toString()
							headers:{"content-type":"application/json"}
							connection:"z_books"
						];
						info "credit note refund process" + refun;
						info cn_ref;
						info creditCreate.get("creditnote").get("creditnote_id");
					}
					else
					{
						sendmail
						[
							from :zoho.loginuserid
							to :"manisha@zocoden.com"
							subject :"credit not creation for depset failed:"
							message :creditCreate + " :: " + credit
						]
					}
				}
			}
		}
		else
		{
			info "customer id empty invoice deps: " + voucher_no;
			info create_customer_resp;
			info new_customer_map;
		}
	}
}
