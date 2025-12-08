import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { DbInstance } from "@cdktf/provider-aws/lib/db-instance";
import { DbSnapshot } from "@cdktf/provider-aws/lib/db-snapshot";

class RdsUpgradeStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new AwsProvider(this, "aws", {
      region: "us-east-1",
    });

    // Create snapshot before upgrade
    const snapshot = new DbSnapshot(this, "pre-upgrade-snapshot", {
      dbInstanceIdentifier: "your-db-instance-id",
      dbSnapshotIdentifier: `pre-upgrade-${Date.now()}`,
    });

    // Upgrade RDS instance
    const rds = new DbInstance(this, "rds-instance", {
      identifier: "your-db-instance-id",
      engine: "postgres",
      engineVersion: "17.2",
      instanceClass: "db.t3.micro",
      allocatedStorage: 20,
      allowMajorVersionUpgrade: true,
      applyImmediately: true,
      skipFinalSnapshot: false,
      finalSnapshotIdentifier: `final-snapshot-${Date.now()}`,
      dependsOn: [snapshot],
    });

    new TerraformOutput(this, "db-endpoint", {
      value: rds.endpoint,
    });
  }
}

const app = new App();
new RdsUpgradeStack(app, "rds-upgrade");
app.synth();
