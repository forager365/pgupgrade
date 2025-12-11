#!/usr/bin/env python3
import boto3
from datetime import datetime, timedelta
import json

def get_rds_configuration(db_instance_id, region='us-east-1'):
    """Get RDS instance configuration"""
    rds = boto3.client('rds', region_name=region)
    
    response = rds.describe_db_instances(DBInstanceIdentifier=db_instance_id)
    db = response['DBInstances'][0]
    
    config = {
        'DBInstanceIdentifier': db['DBInstanceIdentifier'],
        'DBInstanceClass': db['DBInstanceClass'],
        'Engine': db['Engine'],
        'EngineVersion': db['EngineVersion'],
        'AllocatedStorage': db['AllocatedStorage'],
        'StorageType': db['StorageType'],
        'Iops': db.get('Iops'),
        'MultiAZ': db['MultiAZ'],
        'AvailabilityZone': db['AvailabilityZone'],
        'DBParameterGroups': db['DBParameterGroups'],
        'PreferredMaintenanceWindow': db['PreferredMaintenanceWindow'],
        'BackupRetentionPeriod': db['BackupRetentionPeriod'],
        'PerformanceInsightsEnabled': db.get('PerformanceInsightsEnabled'),
        'EnabledCloudwatchLogsExports': db.get('EnabledCloudwatchLogsExports', [])
    }
    
    return config

def get_parameter_group_values(parameter_group_name, region='us-east-1'):
    """Get all parameters from parameter group"""
    rds = boto3.client('rds', region_name=region)
    
    params = []
    marker = None
    
    while True:
        if marker:
            response = rds.describe_db_parameters(
                DBParameterGroupName=parameter_group_name,
                Marker=marker
            )
        else:
            response = rds.describe_db_parameters(
                DBParameterGroupName=parameter_group_name
            )
        
        params.extend(response['Parameters'])
        
        if 'Marker' in response:
            marker = response['Marker']
        else:
            break
    
    return params

def get_enhanced_monitoring(db_instance_id, region='us-east-1'):
    """Get Enhanced Monitoring logs"""
    logs = boto3.client('logs', region_name=region)
    
    log_group = f'/aws/rds/instance/{db_instance_id}/postgresql'
    
    try:
        streams = logs.describe_log_streams(
            logGroupName=log_group,
            orderBy='LastEventTime',
            descending=True,
            limit=5
        )
        return streams['logStreams']
    except:
        return None

def download_all_metrics(db_instance_id, region='us-east-1', hours=24):
    """Download all available metrics and configuration"""
    
    print(f"Collecting data for {db_instance_id}...")
    
    # Get configuration
    print("Getting RDS configuration...")
    config = get_rds_configuration(db_instance_id, region)
    
    # Get parameter group details
    print("Getting parameter group values...")
    param_group_name = config['DBParameterGroups'][0]['DBParameterGroupName']
    parameters = get_parameter_group_values(param_group_name, region)
    
    # Get CloudWatch metrics
    print("Getting CloudWatch metrics...")
    cloudwatch = boto3.client('cloudwatch', region_name=region)
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=hours)
    
    cw_metrics = {}
    metric_names = [
        'CPUUtilization', 'DatabaseConnections', 'FreeableMemory',
        'ReadIOPS', 'WriteIOPS', 'ReadLatency', 'WriteLatency',
        'DiskQueueDepth', 'CommitLatency', 'TransactionLogsDiskUsage'
    ]
    
    for metric in metric_names:
        response = cloudwatch.get_metric_statistics(
            Namespace='AWS/RDS',
            MetricName=metric,
            Dimensions=[{'Name': 'DBInstanceIdentifier', 'Value': db_instance_id}],
            StartTime=start_time,
            EndTime=end_time,
            Period=300,
            Statistics=['Average', 'Maximum']
        )
        cw_metrics[metric] = response['Datapoints']
    
    # Get Performance Insights if enabled
    pi_metrics = None
    if config.get('PerformanceInsightsEnabled'):
        print("Getting Performance Insights data...")
        try:
            pi = boto3.client('pi', region_name=region)
            rds = boto3.client('rds', region_name=region)
            
            response = rds.describe_db_instances(DBInstanceIdentifier=db_instance_id)
            resource_id = response['DBInstances'][0]['DbiResourceId']
            
            pi_metrics = pi.describe_dimension_keys(
                ServiceType='RDS',
                Identifier=resource_id,
                StartTime=start_time,
                EndTime=end_time,
                Metric='db.load.avg',
                GroupBy={'Group': 'db.sql'},
                MaxResults=20
            )
        except Exception as e:
            print(f"Could not retrieve Performance Insights: {e}")
    
    # Compile all data
    all_data = {
        'timestamp': datetime.now().isoformat(),
        'db_instance_id': db_instance_id,
        'configuration': config,
        'parameters': parameters,
        'cloudwatch_metrics': cw_metrics,
        'performance_insights': pi_metrics
    }
    
    # Save to file
    filename = f'rds_complete_report_{db_instance_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(filename, 'w') as f:
        json.dump(all_data, f, indent=2, default=str)
    
    print(f"\nComplete report saved to {filename}")
    print(f"\nSummary:")
    print(f"  Instance Class: {config['DBInstanceClass']}")
    print(f"  Engine: {config['Engine']} {config['EngineVersion']}")
    print(f"  Storage: {config['AllocatedStorage']} GB ({config['StorageType']})")
    print(f"  Multi-AZ: {config['MultiAZ']}")
    print(f"  Performance Insights: {config.get('PerformanceInsightsEnabled', False)}")
    
    return all_data

if __name__ == '__main__':
    DB_INSTANCE_ID = 'your-db-instance-id'
    REGION = 'us-east-1'
    HOURS = 24
    
    download_all_metrics(DB_INSTANCE_ID, REGION, HOURS)
