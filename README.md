# RDS PostgreSQL Upgrade Script

Automated script to upgrade RDS PostgreSQL from version 14 to version 17 using AWS SDK.

## Why This Approach

- **No Terraform State**: Direct AWS SDK calls, no infrastructure state management required
- **Safety First**: Creates snapshot before upgrade for rollback capability
- **Handles Replicas**: Automatically detects and upgrades read replicas
- **Multi-AZ Support**: Standby instances are automatically upgraded with primary

## How It Works

1. **Describe Instance**: Retrieves instance details and identifies read replicas
2. **Create Snapshot**: Takes pre-upgrade snapshot for safety (rollback point)
3. **Upgrade Primary**: Upgrades primary instance to PostgreSQL 17.2
   - Multi-AZ standby is automatically upgraded during this step
4. **Upgrade Replicas**: Iterates through and upgrades each read replica

## Prerequisites

- AWS credentials configured (IAM permissions: `rds:DescribeDBInstances`, `rds:CreateDBSnapshot`, `rds:ModifyDBInstance`)
- Node.js installed
- RDS instance running PostgreSQL 14

## Setup

```bash
npm install
```

## Configuration

Edit `rds-upgrade-standalone.ts`:
- `region`: Your AWS region
- `dbInstanceId`: Your RDS instance identifier

## Usage

```bash
npx ts-node rds-upgrade-standalone.ts
```

## Testing

```bash
npm test
```

## Important Notes

- **Downtime**: Major version upgrades require downtime (typically 5-15 minutes)
- **Test First**: Always test in non-production environment
- **Compatibility**: Review PostgreSQL 17 breaking changes for your application
- **Incremental Upgrades**: Consider 14→15→16→17 if issues occur

## Rollback

If upgrade fails, restore from the pre-upgrade snapshot created by the script.
