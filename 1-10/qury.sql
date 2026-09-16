select [employeeID] as employeeId
      ,[eventTime] as eventTime
      ,[ischeckin] as isCheckin
      ,[downloadDate], Location as location
  FROM [MHI_ZAMAN_POLAR].[dbo].[Attendance] where downloadDate>=$1 and  downloadDate<$2 and Terminal IN (1,2,3,4,5,6,7,10,11,12,13,14,15,8,9)



  select [employeeID] as employeeId
      ,[eventTime] as eventTime
      ,[ischeckin] as isCheckin
      ,[downloadDate], Location as location
  FROM [MHI_ZAMAN_POLAR].[dbo].[Attendance] where employeeID = '3003' and  downloadDate>=$1 and  downloadDate<$2 and Terminal IN (1,2,3,4,5,6,7,10,11,12,13,14,15,8,9)





  04-Sep-2026 10:31:49.357 SEVERE [Thread-5] attendanceclient.ZPAServerRequest.sendArrayHTTPRequest Exception in Catch 1=>{0}
	org.json.JSONException: JSONObject["access_token"] not found.
		at org.json.JSONObject.get(JSONObject.java:573)
		at org.json.JSONObject.getString(JSONObject.java:836)
		at attendanceclient.ZPAServerRequest.fetchAccessToken(ZPAServerRequest.java:235)
		at attendanceclient.ZPAServerRequest.sendArrayHTTPRequest(ZPAServerRequest.java:94)
		at attendanceclient.AttendanceThread.run(AttendanceThread.java:73)



SELECT [employeeID] AS employeeId
      ,[eventTime] AS eventTime
      ,[ischeckin] AS isCheckin
      ,[downloadDate]
      ,Location AS location
FROM [MHI_ZAMAN_POLAR].[dbo].[Attendance]  
WHERE eventTime >= '2026-09-01 00:00:00' 
  AND eventTime < '2026-09-05 00:00:00'
  AND Terminal IN (1,2,3,4,5,6,7,10,11,12,13,14,15,8,9)
  AND employeeID = '10002'
ORDER BY eventTime DESC