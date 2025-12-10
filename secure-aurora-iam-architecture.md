# Secure Aurora PostgreSQL IAM Architecture

## Architecture Components

```
Lambda (IAM Role) → RDS Proxy (IAM Auth) → Aurora PostgreSQL (IAM DB User)
```

## 1. Aurora PostgreSQL Database Setup

### Create IAM Database User
```sql
-- Create IAM-enabled database user
CREATE USER lambda_writer;
GRANT rds_iam TO lambda_writer;

-- Create schemas
CREATE SCHEMA foo;
CREATE SCHEMA bar;

-- Grant minimal permissions (write only to foo and bar)
GRANT USAGE ON SCHEMA foo TO lambda_writer;
GRANT USAGE ON SCHEMA bar TO lambda_writer;

GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA foo TO lambda_writer;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bar TO lambda_writer;

-- Grant on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA foo GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA bar GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;

-- Grant sequence usage for auto-increment columns
GRANT USAGE ON ALL SEQUENCES IN SCHEMA foo TO lambda_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA bar TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA foo GRANT USAGE ON SEQUENCES TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA bar GRANT USAGE ON SEQUENCES TO lambda_writer;

-- Explicitly deny access to other schemas
REVOKE ALL ON SCHEMA public FROM lambda_writer;
```

## 2. Lambda IAM Role

### IAM Policy for Lambda Execution Role
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowRDSConnect",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:us-east-1:123456789012:dbuser:cluster-ABCDEFGHIJK/lambda_writer"
    },
    {
      "Sid": "AllowVPCAccess",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ],
      "Resource": "*"
    }
  ]
}
```

### Lambda Execution Role Trust Policy
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

## 3. RDS Proxy Configuration

### Proxy IAM Authentication Settings
- **Default Auth Schema**: IAM Authentication
- **IAM Authentication**: Required
- **Client Authentication Type**: SCRAM_SHA_256

### Proxy IAM Role Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowProxyToConnectAsIAMUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:us-east-1:123456789012:dbuser:cluster-ABCDEFGHIJK/lambda_writer"
    }
  ]
}
```

### Proxy Trust Policy
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

## 4. Network Security

### Security Group Rules
```
Lambda Security Group (Outbound):
- Port 5432 → RDS Proxy Security Group

RDS Proxy Security Group (Inbound):
- Port 5432 ← Lambda Security Group

RDS Proxy Security Group (Outbound):
- Port 5432 → Aurora Security Group

Aurora Security Group (Inbound):
- Port 5432 ← RDS Proxy Security Group
```

## 5. Aurora Cluster Configuration

### IAM Authentication
- **Enable IAM Database Authentication**: Yes

### Parameter Group Settings
```
rds.force_ssl = 1  (enforce SSL/TLS)
```

## 6. Lambda Connection Code

```python
import boto3
from aws_advanced_python_wrapper import AwsWrapperConnection

def get_connection():
    session = boto3.Session()
    region = session.region_name
    
    return AwsWrapperConnection.connect(
        host='proxy-endpoint.proxy-xxx.us-east-1.rds.amazonaws.com',
        port=5432,
        database='mydb',
        user='lambda_writer',
        wrapper_dialect='postgres',
        plugins='iam',
        region=region
    )
```

## Security Summary

| Component | Principle | Implementation |
|-----------|-----------|----------------|
| **Lambda** | Least privilege IAM | Only `rds-db:connect` for specific user |
| **Database User** | Schema isolation | Access only to `foo` and `bar` schemas |
| **Database User** | Write-only | No SELECT, no DDL, no other schemas |
| **RDS Proxy** | IAM-only auth | No password-based authentication |
| **Network** | Isolation | Security groups restrict traffic flow |
| **Transport** | Encryption | SSL/TLS enforced |
| **Aurora** | IAM validation | Token validated against AWS IAM |

## Key Security Features

1. **No stored credentials** - IAM tokens only
2. **Schema-level isolation** - Cannot access other schemas
3. **Operation-level restriction** - Write operations only (INSERT, UPDATE, DELETE)
4. **Network segmentation** - Security groups enforce traffic paths
5. **Encrypted in transit** - SSL/TLS required
6. **Time-limited tokens** - IAM tokens expire in 15 minutes
7. **Audit trail** - CloudWatch logs all authentication attempts
