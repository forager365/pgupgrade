import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class AuroraIamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1
    });

    // Security Groups
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', { vpc });
    const proxySg = new ec2.SecurityGroup(this, 'ProxySg', { vpc });
    const auroraSg = new ec2.SecurityGroup(this, 'AuroraSg', { vpc });

    proxySg.addIngressRule(lambdaSg, ec2.Port.tcp(5432));
    auroraSg.addIngressRule(proxySg, ec2.Port.tcp(5432));

    // Aurora Cluster
    const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4
      }),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [auroraSg],
      iamAuthentication: true,
      defaultDatabaseName: 'mydb',
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        this, 'ParamGroup', 'default.aurora-postgresql15'
      )
    });

    // RDS Proxy
    const proxy = new rds.DatabaseProxy(this, 'RdsProxy', {
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [proxySg],
      iamAuth: true,
      requireTLS: true
    });

    // Lambda Role
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
      ]
    });

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['rds-db:connect'],
      resources: [`arn:aws:rds-db:${this.region}:${this.account}:dbuser:${cluster.clusterResourceIdentifier}/lambda_writer`]
    }));

    // Lambda Function
    const fn = new lambda.Function(this, 'WriterFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
from aws_advanced_python_wrapper import AwsWrapperConnection

def handler(event, context):
    conn = AwsWrapperConnection.connect(
        host='${proxy.endpoint}',
        port=5432,
        database='mydb',
        user='lambda_writer',
        wrapper_dialect='postgres',
        plugins='iam',
        region='${this.region}',
        sslmode='require'
    )
    cursor = conn.cursor()
    cursor.execute("INSERT INTO foo.table1 (col) VALUES ('test')")
    conn.commit()
    conn.close()
    return {'statusCode': 200}
      `),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30)
    });

    // Outputs
    new cdk.CfnOutput(this, 'ProxyEndpoint', { value: proxy.endpoint });
    new cdk.CfnOutput(this, 'ClusterEndpoint', { value: cluster.clusterEndpoint.hostname });
    new cdk.CfnOutput(this, 'SetupSQL', {
      value: `
-- Run this SQL on Aurora:
CREATE USER lambda_writer;
GRANT rds_iam TO lambda_writer;
ALTER USER lambda_writer SET rds.force_ssl = 1;
CREATE SCHEMA foo;
CREATE SCHEMA bar;
GRANT USAGE ON SCHEMA foo, bar TO lambda_writer;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA foo TO lambda_writer;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bar TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA foo GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA bar GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA foo, bar TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA foo GRANT USAGE ON SEQUENCES TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA bar GRANT USAGE ON SEQUENCES TO lambda_writer;
      `
    });
  }
}
