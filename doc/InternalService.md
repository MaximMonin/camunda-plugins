# InternalService documentation

## Method list
Internal service has many systemwide methods to support business processes:   
**resource.Lock** - Locks some resource exclusively, other processes wait until resource locked   
**resource.Unlock** - Release lock from resource   

**table.AddRows** - Add some data rows to temp table   
**table.Count** - Returns number of rows in temp table   
**table.Read** - Read and save in cache all records of temp table as one object, return link to object in cache   
**cache.Read** - Read data from cache to use data as camunda variable   

**excel.Create** - Create Excel xlsx file from data in many temp tables   

**null** - Do nothing, special method used in tests   
**environment.Get** - Return environment (production, stage, development)   
**processes.StopOther** - Stop all other processes except of current process (kill other of this type)   

**telegram** - Send message to telegram channel   
**telegram.File** - Send file to telegram channel   
**email** - Send email   
**generatePassword** - Generate password   
**encrypt** - Encrypt data with secret key   
**decrypt** - Decrypt data with secret key   

## Method description
### resource.Lock
Method locks some resource exclusively, other processes stop and wait until resource locked when using this method   
Input parameters:   
key (optional) - name of resource to lock, '' if key ommited   
timeout (optional) - time in seconds to lock resource. 10 minutes by default if ommited. Resourse can be locked again by other process after timeout   
Output parameters: none   
If lock is unsuccessful, method returns lock.failed. Process tries to repeat unfinitely lock until successed.   

### resource.Unlock
Method releases lock from resource   
Input parameters:   
key (optional) - name of resource to unlock, '' if key ommited   
Output parameters: none   
Other method to unlock resource is wait for lock timeout   

### table.AddRows
Method adds some data rows to temp table. Data saved as redis list of objects   
Input parameters:   
table - name of temp-table to add rows   
data - array of objects to add to temp-table   
Output parameters: none

### table.Count
Method return number of rows in temp-table added by table.AddRows method   
Input parameters:   
table - name of temp-table   
Output parameters:   
data - number of rows, 0 if table is empty or not exists   

### table.Read
Method reads all rows of temp-table and saves data object in redis cache, returns link to object   
Input parameters:   
table - name of temp-table   
Output parameters:   
data - redis cache object   

### cache.Read
Method reads data from redis cache to use data as camunda variable   
Input parameters:   
data - link to redis cache object   
conversion - can be "base64,json", "base64", "json". "base64" used if data stored as base64 binary data to decode it while reading. "json" used to convert json object to native json camunda variable   
Output parameters:   
data - data as object from cache   

### excel.Create
Method creates/generates xlsx file from data objects and saves result file in redis cache   
Input parameters:   
sheets - array of names of excel sheets to create   
data - array of objects returned by table.Read method. Every table will form 1 sheet of excel file. Column names generated as object fields in temp-tables   
Example:   
```
{
  sheets: ["nodeData", "containerStatus", "containerData", "mysqlData", "diskUsageData"], - form 5 sheet excel file   
  data: [nodeData, containerStatus, containerData, mysqlData, diskUsageData] - with a data from 5 temp-tables
}
```
Output parameters:   
data - link to redis cache object that keeps generated xlsx file   

### null
Method used for tests, do nothing   
Input parameters: none   
Output parameters: none   

### environment.Get
Method used to return current environment data   
Input parameters: none   
Output parameters:   
env object with 2 fields:   
- env.env = "prod", "stage" or "dev" - type of environment   
- env.server - https server link of current environment, used to generate links to processes   

### processes.StopOther
Method uses to stop all other processes of current type of process, except current. If some processes were started earlier but still running and we do need result from it, we can kill (stop) them by using this method.   
Input parameters: none - running processes auto calculated by id of current process and type of current process   
Output parameters: none   

### telegram
Method used to send message to telegram channel   
Input parameters:   
chat_id - telegram channel   
parse_mode - parse mode of telegram message. Ordinary parse_mode = "html" or "markdown". Check telegram [documentation](https://core.telegram.org/bots/api#formatting-options)   
message - data passed as camunda "message" process variable/input parameter. There are many restriction for telegram messages that leads to error return codes. Check telegram bot documentation. Ordinary errors: bad formatting, message to large (max 4096 symbols), spam restriction - camunda sends too many messages.   
Output parameters: none   

### telegram.File
Method used to send file to telegram channel   
Input parameters:   
chat_id - telegram channel   
filename - name of sent file  
data - file data as link to redis cache object. Result of methods excel.Create or file.Read (from container) can be passed as data input parameter   
Output parameters: none   

### email
Method used to send email   
Input parameters:   
to - mail reciever   
from (optional) - mail sender   
cc, bcc (optional) - other mail recievers   
subject - subject of email   
text (optional) - text version of email body   
html (optional) - html version of email body   
attachments (optional) - array of file attachments with filename and content fields, content fields can be text, base64, or link to redis cache file object   
Check https://nodemailer.com/message/ for full documentation about available mail option parameters   
Example:
```
{
  "to": "myemail@domain.com",
  "subject": "Report title",
  "text": "Check attached file for errors",
   "attachments": [
        {
            "filename": "Filename as attachment ${now()}.xlsx",
            "content": "${excelFile}"
        }
   ]
}
```
Output parameters: none   

### generatePassword
Method used to generate new password   
Input parameters:   
Length - length of password   
Output paremeters:   
data - generated password string. By default password string go to redis cache for security reason   

### encrypt
Method used to encrypt sensitive data with secret key   
Input parameters:   
text - text to encrypt   
key - IV to encrypt   
Output paremeters:   
data - generated encrypted string in hex format. By default result string go to redis cache for security reason   

### decrypt
Method used to decrypt sensitive data with secret key   
Input parameters:   
text - encrypted data in hex format   
key - IV to decrypt   
Output paremeters:   
data - decrypted string. By default result string go to redis cache for security reason   
