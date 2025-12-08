import { RDSClient, CreateDBSnapshotCommand, ModifyDBInstanceCommand, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";

const client = new RDSClient({ region: "us-east-1" });
const dbInstanceId = "your-db-instance-id";

export async function upgradeRDS() {
  // Get instance details
  const { DBInstances } = await client.send(new DescribeDBInstancesCommand({
    DBInstanceIdentifier: dbInstanceId
  }));
  const readReplicas = DBInstances?.[0]?.ReadReplicaDBInstanceIdentifiers || [];

  // Create snapshot
  console.log("Creating pre-upgrade snapshot...");
  await client.send(new CreateDBSnapshotCommand({
    DBInstanceIdentifier: dbInstanceId,
    DBSnapshotIdentifier: `pre-upgrade-${Date.now()}`
  }));

  // Upgrade primary (Multi-AZ standby auto-upgrades)
  console.log("Upgrading primary to PostgreSQL 17...");
  await client.send(new ModifyDBInstanceCommand({
    DBInstanceIdentifier: dbInstanceId,
    EngineVersion: "17.2",
    AllowMajorVersionUpgrade: true,
    ApplyImmediately: true
  }));

  // Upgrade read replicas
  for (const replica of readReplicas) {
    console.log(`Upgrading read replica: ${replica}`);
    await client.send(new ModifyDBInstanceCommand({
      DBInstanceIdentifier: replica,
      EngineVersion: "17.2",
      AllowMajorVersionUpgrade: true,
      ApplyImmediately: true
    }));
  }

  console.log("Upgrade initiated successfully");
}

if (require.main === module) {
  upgradeRDS().catch(console.error);
}
