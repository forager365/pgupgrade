# Secure Aurora PostgreSQL with RDS Proxy Architecture
## Least Privilege Security Implementation - us-east-1

---

## Architecture Overview

This architecture implements a highly secure, least-privilege access pattern for AWS Lambda to write data to Aurora PostgreSQL through RDS Proxy using IAM authentication.

### Security Principles
1. **Database User**: Write-only access (INSERT, UPDATE, DELETE) to `foo` and `bar` schemas - no SELECT capability
2. **Lambda IAM Role**: Only `rds-db:connect` permission for the specific database user
3. **RDS Proxy**: IAM authentication required, no password fallback allowed
4. **Network Security**: Security groups enforce strict unidirectional traffic flow
5. **Encryption**: SSL/TLS mandatory for all connections
6. **Token Expiry**: IAM authentication tokens auto-expire in 15 minutes

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         VPC (us-east-1)                     │
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │  Lambda Function (Private Subnet)            │          │
│  │  ┌────────────────────────────────────────┐  │          │
│  │  │  IAM Role: lambda-aurora-writer-role   │  │          │
│  │  │  Policy: rds-db:connect ONLY           │  │          │
│  │  │  User: lambda_writer                   │  │          │
│  │  │  Token: 15-min expiry                  │  │          │
│  │  └────────────────────────────────────────┘  │          │
│  │  Security Group: lambda-sg                   │          │
│  └──────────┬───────────────────────────────────┘          │
│             │ Port 5432 (PostgreSQL)                        │
│             │ SSL/TLS Required                              │
│             ▼                                               │
│  ┌──────────────────────────────────────────────┐          │
│  │  RDS Proxy (Private Subnet)                  │          │
│  │  ┌────────────────────────────────────────┐  │          │
│  │  │  IAM Role: rds-proxy-role              │  │          │
│  │  │  Auth: IAM ONLY (no passwords)         │  │          │
│  │  │  Validates: rds-db:connect permission  │  │          │
│  │  └────────────────────────────────────────┘  │          │
│  │  Security Group: rds-proxy-sg                │          │
│  └──────────┬───────────────────────────────────┘          │
│             │ Port 5432 (PostgreSQL)                        │
│             │ Authenticated Connection                      │
│             ▼                                               │
│  ┌──────────────────────────────────────────────┐          │
│  │  Aurora PostgreSQL Cluster                    │          │
│  │  (Private Subnets - Multi-AZ)                │          │
│  │  ┌────────────────────────────────────────┐  │          │
│  │  │  Database User: lambda_writer          │  │          │
│  │  │  Grants: INSERT, UPDATE, DELETE        │  │          │
│  │  │  Schemas: foo, bar ONLY                │  │          │
│  │  │  No SELECT, No DDL                     │  │          │
│  │  └────────────────────────────────────────┘  │          │
│  │  Security Group: aurora-sg                   │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Lambda IAM Role Configuration

### Role Name: `lambda-aurora-writer-role`

### Trust Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### IAM Policy: `lambda-rds-connect-policy`
**CRITICAL: Only allows connection as lambda_writer user**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowRDSConnect",
      "Effect": "Allow",
      "Action": [
        "rds-db:connect"
      ],
      "Resource": "arn:aws:rds-db:us-east-1:ACCOUNT_ID:dbuser:prxy-PROXY_RESOURCE_ID/lambda_writer"
    }
  ]
}
```

**Key Points:**
- Resource ARN format: `arn:aws:rds-db:REGION:ACCOUNT:dbuser:PROXY_RESOURCE_ID/DB_USERNAME`
- Replace `PROXY_RESOURCE_ID` with your actual proxy resource ID (found in proxy details)
- Username `lambda_writer` is hardcoded in the resource ARN
- Lambda **cannot** connect as any other database user

### Basic Lambda Execution Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BasicLambdaExecution",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:ACCOUNT_ID:log-group:/aws/lambda/*"
    },
    {
      "Sid": "VPCExecution",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface",
        "ec2:AssignPrivateIpAddresses",
        "ec2:UnassignPrivateIpAddresses"
      ],
      "Resource": "*"
    }
  ]
}
```

### AWS CLI Commands

```bash
# Create IAM role
aws iam create-role \
  --role-name lambda-aurora-writer-role \
  --assume-role-policy-document file://lambda-trust-policy.json \
  --region us-east-1

# Create and attach RDS connect policy
aws iam put-role-policy \
  --role-name lambda-aurora-writer-role \
  --policy-name lambda-rds-connect-policy \
  --policy-document file://lambda-rds-connect-policy.json \
  --region us-east-1

# Attach AWS managed policy for Lambda VPC execution
aws iam attach-role-policy \
  --role-name lambda-aurora-writer-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole \
  --region us-east-1
```

---

## 2. RDS Proxy IAM Role Configuration

### Role Name: `rds-proxy-role`

### Trust Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "rds.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### IAM Policy: `rds-proxy-secrets-policy`
**Note: RDS Proxy still needs Secrets Manager for initial database authentication setup**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSecretsManagerAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:aurora-master-secret-*"
    },
    {
      "Sid": "AllowKMSDecrypt",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:us-east-1:ACCOUNT_ID:key/KMS_KEY_ID",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.us-east-1.amazonaws.com"
        }
      }
    }
  ]
}
```

### AWS CLI Commands

```bash
# Create IAM role for RDS Proxy
aws iam create-role \
  --role-name rds-proxy-role \
  --assume-role-policy-document file://rds-proxy-trust-policy.json \
  --region us-east-1

# Attach Secrets Manager policy
aws iam put-role-policy \
  --role-name rds-proxy-role \
  --policy-name rds-proxy-secrets-policy \
  --policy-document file://rds-proxy-secrets-policy.json \
  --region us-east-1
```

---

## 3. Aurora PostgreSQL Configuration

### Cluster Settings

#### Enable IAM Authentication
```bash
# Enable IAM authentication on Aurora cluster
aws rds modify-db-cluster \
  --db-cluster-identifier my-aurora-cluster \
  --enable-iam-database-authentication \
  --apply-immediately \
  --region us-east-1

# Enable IAM authentication on Aurora instance
aws rds modify-db-instance \
  --db-instance-identifier my-aurora-instance \
  --enable-iam-database-authentication \
  --apply-immediately \
  --region us-east-1
```

### Database User Setup

#### Connect as Master User
```bash
psql -h your-aurora-endpoint.us-east-1.rds.amazonaws.com \
     -U postgres \
     -d mydb
```

#### Create Schemas
```sql
-- Create schemas if they don't exist
CREATE SCHEMA IF NOT EXISTS foo;
CREATE SCHEMA IF NOT EXISTS bar;
```

#### Create Database User
```sql
-- Create user for Lambda (no password needed for IAM auth)
CREATE USER lambda_writer;

-- Grant rds_iam role (required for IAM authentication)
GRANT rds_iam TO lambda_writer;

-- Grant connect permission to database
GRANT CONNECT ON DATABASE mydb TO lambda_writer;
```

#### Grant Write-Only Permissions to foo Schema
```sql
-- Grant schema usage
GRANT USAGE ON SCHEMA foo TO lambda_writer;

-- Grant write permissions on all existing tables
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA foo TO lambda_writer;

-- Grant write permissions on future tables (auto-grant)
ALTER DEFAULT PRIVILEGES IN SCHEMA foo 
  GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;

-- Grant sequence usage (for auto-increment columns)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA foo TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA foo 
  GRANT USAGE ON SEQUENCES TO lambda_writer;

-- EXPLICITLY REVOKE SELECT if it was granted
REVOKE SELECT ON ALL TABLES IN SCHEMA foo FROM lambda_writer;
```

#### Grant Write-Only Permissions to bar Schema
```sql
-- Grant schema usage
GRANT USAGE ON SCHEMA bar TO lambda_writer;

-- Grant write permissions on all existing tables
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bar TO lambda_writer;

-- Grant write permissions on future tables (auto-grant)
ALTER DEFAULT PRIVILEGES IN SCHEMA bar 
  GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;

-- Grant sequence usage (for auto-increment columns)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA bar TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA bar 
  GRANT USAGE ON SEQUENCES TO lambda_writer;

-- EXPLICITLY REVOKE SELECT if it was granted
REVOKE SELECT ON ALL TABLES IN SCHEMA bar FROM lambda_writer;
```

#### Verify Permissions
```sql
-- Check user permissions
\du lambda_writer

-- Check schema permissions
SELECT 
    schemaname,
    tablename,
    has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'SELECT') as can_select,
    has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'INSERT') as can_insert,
    has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'UPDATE') as can_update,
    has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'DELETE') as can_delete
FROM pg_tables
WHERE schemaname IN ('foo', 'bar');
```

#### Expected Output
```
 schemaname | tablename | can_select | can_insert | can_update | can_delete 
------------+-----------+------------+------------+------------+------------
 foo        | table1    | f          | t          | t          | t
 foo        | table2    | f          | t          | t          | t
 bar        | table1    | f          | t          | t          | t
```

### Security Verification Script
```sql
-- Save this as verify_lambda_writer_security.sql
DO $$
DECLARE
    rec RECORD;
    violations TEXT := '';
BEGIN
    -- Check for SELECT permission (should be NONE)
    FOR rec IN 
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname IN ('foo', 'bar')
          AND has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'SELECT')
    LOOP
        violations := violations || 'VIOLATION: lambda_writer has SELECT on ' || 
                     rec.schemaname || '.' || rec.tablename || E'\n';
    END LOOP;
    
    -- Check for permissions on other schemas (should be NONE)
    FOR rec IN
        SELECT DISTINCT schemaname
        FROM pg_tables
        WHERE schemaname NOT IN ('foo', 'bar', 'pg_catalog', 'information_schema')
          AND (has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'SELECT')
               OR has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'INSERT')
               OR has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'UPDATE')
               OR has_table_privilege('lambda_writer', schemaname || '.' || tablename, 'DELETE'))
    LOOP
        violations := violations || 'VIOLATION: lambda_writer has permissions on unauthorized schema: ' || 
                     rec.schemaname || E'\n';
    END LOOP;
    
    IF violations = '' THEN
        RAISE NOTICE 'SUCCESS: All security checks passed. lambda_writer has write-only access to foo and bar schemas only.';
    ELSE
        RAISE WARNING 'SECURITY VIOLATIONS FOUND:%', E'\n' || violations;
    END IF;
END $$;
```

---

## 4. RDS Proxy Configuration

### Create RDS Proxy

```bash
# Get subnet IDs for private subnets
SUBNET_IDS="subnet-xxxxx,subnet-yyyyy,subnet-zzzzz"

# Get security group ID for RDS Proxy
PROXY_SG="sg-proxy123"

# Get RDS Proxy IAM role ARN
PROXY_ROLE_ARN="arn:aws:iam::ACCOUNT_ID:role/rds-proxy-role"

# Get secret ARN containing master credentials
SECRET_ARN="arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:aurora-master-secret"

# Create RDS Proxy
aws rds create-db-proxy \
  --db-proxy-name aurora-write-proxy \
  --engine-family POSTGRESQL \
  --auth '[
    {
      "AuthScheme": "SECRETS",
      "SecretArn": "'$SECRET_ARN'",
      "IAMAuth": "REQUIRED"
    }
  ]' \
  --role-arn $PROXY_ROLE_ARN \
  --vpc-subnet-ids $SUBNET_IDS \
  --vpc-security-group-ids $PROXY_SG \
  --require-tls \
  --region us-east-1
```

### Register Aurora Cluster with Proxy

```bash
aws rds register-db-proxy-targets \
  --db-proxy-name aurora-write-proxy \
  --db-cluster-identifiers my-aurora-cluster \
  --region us-east-1
```

### Key Proxy Configuration Points

1. **IAMAuth: REQUIRED** - Enforces IAM authentication, no password fallback
2. **require-tls: true** - Enforces SSL/TLS encryption in transit
3. **AuthScheme: SECRETS** - Proxy uses Secrets Manager for its own database authentication

### Get Proxy Endpoint

```bash
aws rds describe-db-proxies \
  --db-proxy-name aurora-write-proxy \
  --query 'DBProxies[0].Endpoint' \
  --output text \
  --region us-east-1
```

**Output example:** `aurora-write-proxy.proxy-abc123xyz.us-east-1.rds.amazonaws.com`

### Get Proxy Resource ID (for IAM policy)

```bash
aws rds describe-db-proxies \
  --db-proxy-name aurora-write-proxy \
  --query 'DBProxies[0].DBProxyArn' \
  --output text \
  --region us-east-1
```

**Output example:** `arn:aws:rds:us-east-1:123456789012:db-proxy:prxy-abc123xyz`
**Extract:** `prxy-abc123xyz` (this is your PROXY_RESOURCE_ID)

---

## 5. Security Groups Configuration

### Lambda Security Group (lambda-sg)

```bash
# Create security group
aws ec2 create-security-group \
  --group-name lambda-sg \
  --description "Security group for Lambda functions accessing Aurora via RDS Proxy" \
  --vpc-id vpc-xxxxx \
  --region us-east-1

# No inbound rules needed (Lambda initiates connections)

# Outbound rule: Allow PostgreSQL to RDS Proxy
aws ec2 authorize-security-group-egress \
  --group-id sg-lambda123 \
  --ip-permissions IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=sg-proxy123}] \
  --region us-east-1
```

### RDS Proxy Security Group (rds-proxy-sg)

```bash
# Create security group
aws ec2 create-security-group \
  --group-name rds-proxy-sg \
  --description "Security group for RDS Proxy" \
  --vpc-id vpc-xxxxx \
  --region us-east-1

# Inbound rule: Allow PostgreSQL from Lambda
aws ec2 authorize-security-group-ingress \
  --group-id sg-proxy123 \
  --ip-permissions IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=sg-lambda123}] \
  --region us-east-1

# Outbound rule: Allow PostgreSQL to Aurora
aws ec2 authorize-security-group-egress \
  --group-id sg-proxy123 \
  --ip-permissions IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=sg-aurora123}] \
  --region us-east-1
```

### Aurora Security Group (aurora-sg)

```bash
# Create security group
aws ec2 create-security-group \
  --group-name aurora-sg \
  --description "Security group for Aurora PostgreSQL cluster" \
  --vpc-id vpc-xxxxx \
  --region us-east-1

# Inbound rule: Allow PostgreSQL from RDS Proxy ONLY
aws ec2 authorize-security-group-ingress \
  --group-id sg-aurora123 \
  --ip-permissions IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=sg-proxy123}] \
  --region us-east-1

# No direct access from Lambda - CRITICAL for security
```

### Security Group Flow Diagram

```
lambda-sg (Outbound: 5432) 
    → rds-proxy-sg (Inbound: 5432 from lambda-sg, Outbound: 5432)
        → aurora-sg (Inbound: 5432 from rds-proxy-sg ONLY)
```

---

## 6. Lambda Function Implementation

### Go Implementation

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "os"
    "time"

    "github.com/aws/aws-lambda-go/lambda"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/feature/rds/auth"
    _ "github.com/lib/pq"
)

type Event struct {
    Schema string                 `json:"schema"` // "foo" or "bar"
    Table  string                 `json:"table"`
    Data   map[string]interface{} `json:"data"`
}

type Response struct {
    StatusCode int    `json:"statusCode"`
    Message    string `json:"message"`
}

var (
    proxyEndpoint = os.Getenv("PROXY_ENDPOINT") // aurora-write-proxy.proxy-xxx.us-east-1.rds.amazonaws.com
    dbRegion      = os.Getenv("DB_REGION")       // us-east-1
    dbUser        = "lambda_writer"              // Hardcoded for security
    dbName        = os.Getenv("DB_NAME")         // mydb
    dbPort        = 5432
)

// Global connection pool
var db *sql.DB

func init() {
    var err error
    db, err = getConnection()
    if err != nil {
        panic(fmt.Sprintf("Failed to initialize database connection: %v", err))
    }
    
    // Configure connection pool
    db.SetMaxOpenConns(5)
    db.SetMaxIdleConns(2)
    db.SetConnMaxLifetime(14 * time.Minute) // Refresh before token expiry
}

func getConnection() (*sql.DB, error) {
    ctx := context.Background()
    
    // Load AWS configuration (uses Lambda execution role)
    cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(dbRegion))
    if err != nil {
        return nil, fmt.Errorf("failed to load AWS config: %w", err)
    }
    
    // Generate IAM authentication token
    endpoint := fmt.Sprintf("%s:%d", proxyEndpoint, dbPort)
    authToken, err := auth.BuildAuthToken(ctx, endpoint, dbRegion, dbUser, cfg.Credentials)
    if err != nil {
        return nil, fmt.Errorf("failed to build auth token: %w", err)
    }
    
    // Build connection string
    dsn := fmt.Sprintf(
        "host=%s port=%d user=%s password=%s dbname=%s sslmode=require",
        proxyEndpoint,
        dbPort,
        dbUser,
        authToken,
        dbName,
    )
    
    // Open database connection
    database, err := sql.Open("postgres", dsn)
    if err != nil {
        return nil, fmt.Errorf("failed to open database: %w", err)
    }
    
    // Test connection
    if err := database.PingContext(ctx); err != nil {
        return nil, fmt.Errorf("failed to ping database: %w", err)
    }
    
    return database, nil
}

func handler(ctx context.Context, event Event) (Response, error) {
    // Validate schema (only foo and bar allowed)
    if event.Schema != "foo" && event.Schema != "bar" {
        return Response{
            StatusCode: 400,
            Message:    "Invalid schema. Only 'foo' and 'bar' are allowed",
        }, nil
    }
    
    // Example: Insert data
    query := fmt.Sprintf(
        "INSERT INTO %s.%s (column1, column2) VALUES ($1, $2)",
        event.Schema,
        event.Table,
    )
    
    _, err := db.ExecContext(ctx, query, event.Data["column1"], event.Data["column2"])
    if err != nil {
        return Response{
            StatusCode: 500,
            Message:    fmt.Sprintf("Failed to insert data: %v", err),
        }, err
    }
    
    return Response{
        StatusCode: 200,
        Message:    "Data inserted successfully",
    }, nil
}

func main() {
    lambda.Start(handler)
}
```

### Lambda Deployment Package

**go.mod**
```go
module lambda-aurora-writer

go 1.21

require (
    github.com/aws/aws-lambda-go v1.41.0
    github.com/aws/aws-sdk-go-v2 v1.24.0
    github.com/aws/aws-sdk-go-v2/config v1.26.1
    github.com/aws/aws-sdk-go-v2/feature/rds/auth v1.3.0
    github.com/lib/pq v1.10.9
)
```

### Build and Deploy

```bash
# Build for Linux
GOOS=linux GOARCH=amd64 go build -o bootstrap main.go

# Create deployment package
zip lambda-function.zip bootstrap

# Deploy Lambda
aws lambda create-function \
  --function-name aurora-writer-lambda \
  --runtime provided.al2 \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-aurora-writer-role \
  --handler bootstrap \
  --zip-file fileb://lambda-function.zip \
  --timeout 30 \
  --memory-size 256 \
  --vpc-config SubnetIds=subnet-xxx,subnet-yyy,SecurityGroupIds=sg-lambda123 \
  --environment Variables="{
    PROXY_ENDPOINT=aurora-write-proxy.proxy-xxx.us-east-1.rds.amazonaws.com,
    DB_REGION=us-east-1,
    DB_NAME=mydb
  }" \
  --region us-east-1
```

---

## 7. Testing and Verification

### Test 1: Verify IAM Authentication Works

```bash
# Invoke Lambda
aws lambda invoke \
  --function-name aurora-writer-lambda \
  --payload '{
    "schema": "foo",
    "table": "test_table",
    "data": {
      "column1": "value1",
      "column2": "value2"
    }
  }' \
  --region us-east-1 \
  response.json

cat response.json
```

**Expected:** `{"statusCode": 200, "message": "Data inserted successfully"}`

### Test 2: Verify Write-Only Access (No SELECT)

Connect to Aurora as `lambda_writer` to test permissions:

```bash
# Generate token manually
TOKEN=$(aws rds generate-db-auth-token \
  --hostname aurora-write-proxy.proxy-xxx.us-east-1.rds.amazonaws.com \
  --port 5432 \
  --username lambda_writer \
  --region us-east-1)

# Try to connect and SELECT (should fail)
PGPASSWORD=$TOKEN psql \
  -h aurora-write-proxy.proxy-xxx.us-east-1.rds.amazonaws.com \
  -U lambda_writer \
  -d mydb \
  -c "SELECT * FROM foo.test_table;"
```

**Expected:** `ERROR: permission denied for table test_table`

### Test 3: Verify INSERT Works

```bash
PGPASSWORD=$TOKEN psql \
  -h aurora-write-proxy.proxy-xxx.us-east-1.rds.amazonaws.com \
  -U lambda_writer \
  -d mydb \
  -c "INSERT INTO foo.test_table (column1, column2) VALUES ('test', 'data');"
```

**Expected:** `INSERT 0 1`

### Test 4: Verify Schema Isolation

```bash
# Try to access public schema (should fail)
PGPASSWORD=$TOKEN psql \
  -h aurora-write-proxy.proxy-xxx.us-east-1.rds.amazonaws.com \
  -U lambda_writer \
  -d mydb \
  -c "INSERT INTO public.some_table (col) VALUES ('data');"
```

**Expected:** `ERROR: permission denied for schema public` or `ERROR: relation "public.some_table" does not exist`

### Test 5: Verify Connection via RDS Proxy Only

```bash
# Try to connect directly to Aurora (should fail due to security group)
PGPASSWORD=$TOKEN psql \
  -h direct-aurora-endpoint.us-east-1.rds.amazonaws.com \
  -U lambda_writer \
  -d mydb \
  -c "SELECT 1;"
```

**Expected:** Connection timeout (Lambda security group doesn't allow direct Aurora access)

---

## 8. Monitoring and Logging

### CloudWatch Metrics to Monitor

```bash
# RDS Proxy metrics
- DatabaseConnections
- ClientConnections
- DatabaseConnectionsCurrentlySessionPinned
- QueryDatabaseResponseLatency

# Aurora metrics
- DatabaseConnections (per user)
- CommitLatency
- DMLLatency
```

### CloudWatch Log Groups

1. `/aws/lambda/aurora-writer-lambda` - Lambda execution logs
2. `/aws/rds/proxy/aurora-write-proxy` - RDS Proxy logs (enable in proxy settings)

### Enable RDS Proxy Logging

```bash
aws rds modify-db-proxy \
  --db-proxy-name aurora-write-proxy \
  --debug-logging \
  --region us-east-1
```

### CloudWatch Logs Insights Query

```sql
-- Find failed authentication attempts
fields @timestamp, @message
| filter @message like /authentication failed/
| sort @timestamp desc
| limit 100

-- Find permission denied errors
fields @timestamp, @message
| filter @message like /permission denied/
| sort @timestamp desc
| limit 100

-- Track connection patterns
fields @timestamp, @message
| filter @message like /new connection/
| stats count() by bin(5m)
```

---

## 9. Security Audit Checklist

### ✅ IAM Permissions
- [ ] Lambda role has ONLY `rds-db:connect` for `lambda_writer` user
- [ ] No `rds:*` or `rds-db:*` wildcard permissions
- [ ] Resource ARN includes specific proxy ID and username
- [ ] RDS Proxy role has Secrets Manager access only for required secret

### ✅ Database Permissions
- [ ] `lambda_writer` has NO SELECT permission
- [ ] `lambda_writer` has INSERT, UPDATE, DELETE ONLY on `foo` schema
- [ ] `lambda_writer` has INSERT, UPDATE, DELETE ONLY on `bar` schema
- [ ] `lambda_writer` has NO permissions on `public` schema
- [ ] `lambda_writer` has NO DDL permissions (CREATE, DROP, ALTER)
- [ ] `lambda_writer` has `rds_iam` role granted
- [ ] Default privileges configured for future tables

### ✅ Network Security
- [ ] Lambda is in private subnet
- [ ] Lambda security group allows outbound to RDS Proxy only
- [ ] RDS Proxy allows inbound from Lambda only
- [ ] Aurora allows inbound from RDS Proxy only
-