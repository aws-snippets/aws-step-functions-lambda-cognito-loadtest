import json
import boto3
import os
import logging
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
cognitoClient = boto3.client('cognito-idp')
clientId = os.environ['client_id']
poolId = os.environ['userpool_id']
NUMBER_OF_USERS = 10

class SecretsManagerSecret:
    """Encapsulates Secrets Manager functions."""
    def __init__(self, secretsmanager_client):
        """
        :param secretsmanager_client: A Boto3 Secrets Manager client.
        """
        self.secretsmanager_client = secretsmanager_client
        self.name = None

    def _clear(self):
        self.name = None

    def setName(self, name):
        self.name = name


    def delete(self, without_recovery):
        """
        Deletes the secret.

        :param without_recovery: Permanently deletes the secret immediately when True;
                                 otherwise, the deleted secret can be restored within
                                 the recovery window. The default recovery window is
                                 30 days.
        """
        if self.name is None:
            raise ValueError

        try:
            self.secretsmanager_client.delete_secret(
                SecretId=self.name, ForceDeleteWithoutRecovery=without_recovery)
            logger.info("Deleted secret %s.", self.name)
            self._clear()
        except ClientError:
            logger.exception("Deleted secret %s.", self.name)
            raise


def deleteSecret(userName):
    try:
        secret = SecretsManagerSecret(boto3.client('secretsmanager'))
        secret.setName(userName)
        secret.delete(True)
    except Exception as e:
        print("ExceptionSecret exception for {} {}".format(userName, e))


def deleteSpecifiedUsers(numberOfUsers):
    for i in range(0, numberOfUsers, 1):
        userName = 'loadtestuser'+str(i)
        try:
            cognitoClient.admin_delete_user(
                UserPoolId=poolId,
                Username=userName)
                
            deleteSecret(userName)
            print("Deleted user {} {}. Continuing".format(userName, poolId))
        except Exception as e:
            print("Failed deleting user {}. Continuing".format(userName))

def lambda_handler(event, context):
    numberOfUsers = int(event['NumberOfUsers'] or NUMBER_OF_USERS)
    deleteSpecifiedUsers(numberOfUsers)

    return numberOfUsers
        