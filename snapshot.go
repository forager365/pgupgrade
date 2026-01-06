package main

import (
	"context"
	"encoding/csv"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/rds"
)

/*
Supports:
- Aurora (DB Cluster snapshots)
- RDS Single-AZ & Multi-AZ (DB Instance snapshots)

Authentication:
- AWS Identity Center (SSO) via named profile
- Also works with static credentials if present
*/

func main() {
	var identifier string
	var days int
	var profile string

	flag.StringVar(&identifier, "identifier", "", "DB Cluster Identifier (Aurora) OR DB Instance Identifier (RDS)")
	flag.IntVar(&days, "days", 30, "Number of days to look back")
	flag.StringVar(&profile, "profile", "default", "AWS config profile (SSO / Identity Center supported)")
	flag.Parse()

	if identifier == "" {
		fmt.Println("--identifier is required")
		os.Exit(1)
	}

	region := "us-east-1"
	ctx := context.Background()

	// Load config with Identity Center (SSO) profile support
	cfg, err := config.LoadDefaultConfig(
		ctx,
		config.WithRegion(region),
		config.WithSharedConfigProfile(profile),
	)
	if err != nil {
		panic(err)
	}

	rdsClient := rds.NewFromConfig(cfg)
	startTime := time.Now().AddDate(0, 0, -days)

	clusterSnapshots, err := fetchClusterSnapshots(ctx, rdsClient, identifier, startTime)
	if err != nil {
		panic(err)
	}

	instanceSnapshots, err := fetchInstanceSnapshots(ctx, rdsClient, identifier, startTime)
	if err != nil {
		panic(err)
	}

	output := "rds_snapshots.csv"
	if err := writeSnapshotsToCSV(output, append(clusterSnapshots, instanceSnapshots...)); err != nil {
		panic(err)
	}

	fmt.Printf("Snapshot inventory written to %s\n", output)
}

// Unified snapshot model
type Snapshot struct {
	SnapshotIdentifier string
	SnapshotARN        string
	ResourceIdentifier string
	SnapshotCreateTime time.Time
	Status             string
	SnapshotScope      string // CLUSTER or INSTANCE
}

// -------- Aurora / Cluster snapshots --------

func fetchClusterSnapshots(ctx context.Context, client *rds.Client, clusterIdentifier string, startTime time.Time) ([]Snapshot, error) {
	var snapshots []Snapshot

	paginator := rds.NewDescribeDBClusterSnapshotsPaginator(client, &rds.DescribeDBClusterSnapshotsInput{
		DBClusterIdentifier: aws.String(clusterIdentifier),
	})

	for paginator.HasMorePages() {
		out, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}

		for _, s := range out.DBClusterSnapshots {
			if s.SnapshotCreateTime != nil && s.SnapshotCreateTime.After(startTime) {
				snapshots = append(snapshots, Snapshot{
					SnapshotIdentifier: aws.ToString(s.DBClusterSnapshotIdentifier),
					SnapshotARN:        aws.ToString(s.DBClusterSnapshotArn),
					ResourceIdentifier: aws.ToString(s.DBClusterIdentifier),
					SnapshotCreateTime: *s.SnapshotCreateTime,
					Status:             aws.ToString(s.Status),
					SnapshotScope:      "CLUSTER",
				})
			}
		}
	}

	return snapshots, nil
}

// -------- RDS Instance snapshots --------

func fetchInstanceSnapshots(ctx context.Context, client *rds.Client, instanceIdentifier string, startTime time.Time) ([]Snapshot, error) {
	var snapshots []Snapshot

	paginator := rds.NewDescribeDBSnapshotsPaginator(client, &rds.DescribeDBSnapshotsInput{
		DBInstanceIdentifier: aws.String(instanceIdentifier),
	})

	for paginator.HasMorePages() {
		out, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}

		for _, s := range out.DBSnapshots {
			if s.SnapshotCreateTime != nil && s.SnapshotCreateTime.After(startTime) {
				snapshots = append(snapshots, Snapshot{
					SnapshotIdentifier: aws.ToString(s.DBSnapshotIdentifier),
					SnapshotARN:        aws.ToString(s.DBSnapshotArn),
					ResourceIdentifier: aws.ToString(s.DBInstanceIdentifier),
					SnapshotCreateTime: *s.SnapshotCreateTime,
					Status:             aws.ToString(s.Status),
					SnapshotScope:      "INSTANCE",
				})
			}
		}
	}

	return snapshots, nil
}

// -------- CSV Writer --------

func writeSnapshotsToCSV(filename string, snapshots []Snapshot) error {
	file, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	w := csv.NewWriter(file)
	defer w.Flush()

	headers := []string{
		"SnapshotIdentifier",
		"SnapshotARN",
		"DBClusterIdentifier / DBInstanceIdentifier",
		"SnapshotCreateTime",
		"Status",
		"Scope",
	}

	if err := w.Write(headers); err != nil {
		return err
	}

	for _, s := range snapshots {
		row := []string{
			s.SnapshotIdentifier,
			s.SnapshotARN,
			s.ResourceIdentifier,
			s.SnapshotCreateTime.Format(time.RFC3339),
			s.Status,
			s.SnapshotScope,
		}

		if err := w.Write(row); err != nil {
			return err
		}
	}

	return nil
}
