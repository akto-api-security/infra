function extract_account_id(tag, timestamp, record)
    local log = record["log"]
    if log ~= nil then
        -- First try 'accountId'
        local account_id = string.match(log, "accountId[%s:]+(%d+)")
        -- If not found, try 'acc'
        if account_id == nil then
            account_id = string.match(log, "acc[%s:]+(%d+)")
        end
        if account_id ~= nil then
            record["log_account_id"] = account_id
        end
    end
    return 1, timestamp, record
end