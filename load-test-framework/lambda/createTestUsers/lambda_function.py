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

    def create(self, name, secret_value):
        """
        Creates a new secret. The secret value can be a string or bytes.

        :param name: The name of the secret to create.
        :param secret_value: The value of the secret.
        :return: Metadata about the newly created secret.
        """
        self._clear()
        try:
            kwargs = {'Name': name}
            if isinstance(secret_value, str):
                kwargs['SecretString'] = secret_value
            elif isinstance(secret_value, bytes):
                kwargs['SecretBinary'] = secret_value
            response = self.secretsmanager_client.create_secret(**kwargs)
            self.name = name
            logger.info("Created secret %s.", name)
        except ClientError:
            logger.exception("Couldn't get secret %s.", name)
            raise
        else:
            return response

    def describe(self, name=None):
        """
        Gets metadata about a secret.

        :param name: The name of the secret to load. If `name` is None, metadata about
                     the current secret is retrieved.
        :return: Metadata about the secret.
        """
        if self.name is None and name is None:
            raise ValueError
        if name is None:
            name = self.name
        self._clear()
        try:
            response = self.secretsmanager_client.describe_secret(SecretId=name)
            self.name = name
            logger.info("Got secret metadata for %s.", name)
        except ClientError:
            logger.exception("Couldn't get secret metadata for %s.", name)
            raise
        else:
            return response

    def get_value(self, stage=None):
        """
        Gets the value of a secret.

        :param stage: The stage of the secret to retrieve. If this is None, the
                      current stage is retrieved.
        :return: The value of the secret. When the secret is a string, the value is
                 contained in the `SecretString` field. When the secret is bytes,
                 it is contained in the `SecretBinary` field.
        """
        if self.name is None:
            raise ValueError

        try:
            kwargs = {'SecretId': self.name}
            if stage is not None:
                kwargs['VersionStage'] = stage
            response = self.secretsmanager_client.get_secret_value(**kwargs)
            logger.info("Got value for secret %s.", self.name)
        except ClientError:
            logger.exception("Couldn't get value for secret %s.", self.name)
            raise
        else:
            return response

    def get_random_password(self, pw_length):
        """
        Gets a randomly generated password.

        :param pw_length: The length of the password.
        :return: The generated password.
        """
        try:
            response = self.secretsmanager_client.get_random_password(
                PasswordLength=pw_length)
            password = response['RandomPassword']
            logger.info("Got random password.")
        except ClientError:
            logger.exception("Couldn't get random password.")
            raise
        else:
            return password

    def put_value(self, secret_value, stages=None):
        """
        Puts a value into an existing secret. When no stages are specified, the
        value is set as the current ('AWSCURRENT') stage and the previous value is
        moved to the 'AWSPREVIOUS' stage. When a stage is specified that already
        exists, the stage is associated with the new value and removed from the old
        value.

        :param secret_value: The value to add to the secret.
        :param stages: The stages to associate with the secret.
        :return: Metadata about the secret.
        """
        if self.name is None:
            raise ValueError

        try:
            kwargs = {'SecretId': self.name}
            if isinstance(secret_value, str):
                kwargs['SecretString'] = secret_value
            elif isinstance(secret_value, bytes):
                kwargs['SecretBinary'] = secret_value
            if stages is not None:
                kwargs['VersionStages'] = stages
            response = self.secretsmanager_client.put_secret_value(**kwargs)
            logger.info("Value put in secret %s.", self.name)
        except ClientError:
            logger.exception("Couldn't put value in secret %s.", self.name)
            raise
        else:
            return response
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

    def list(self, max_results):
        """
        Lists secrets for the current account.

        :param max_results: The maximum number of results to return.
        :return: Yields secrets one at a time.
        """
        try:
            paginator = self.secretsmanager_client.get_paginator('list_secrets')
            for page in paginator.paginate(
                    PaginationConfig={'MaxItems': max_results}):
                for secret in page['SecretList']:
                    yield secret
        except ClientError:
            logger.exception("Couldn't list secrets.")
            raise

def getPassword(userName):
    try:
        secret = SecretsManagerSecret(boto3.client('secretsmanager'))
        secret.create(userName, secret.get_random_password(20))
    except Exception as e:
        print("ExceptionSecret exception for {} {}".format(userName, e))
    finally:
        secret.setName(userName)
        value = secret.get_value()
        print(f"Secret value: {value['SecretString']}")
        return value['SecretString']
        
def deleteSecret(userName):
    try:
        secret = SecretsManagerSecret(boto3.client('secretsmanager'))
        secret.setName(userName)
        secret.delete(True)
    except Exception as e:
        print("ExceptionSecret exception for {} {}".format(userName, e))


def createUsers(i, userNames):
    try:
        userName = 'loadtestuser'+str(i)
        password = getPassword(userName)
        userNames.append(userName)
    
        response = cognitoClient.sign_up(
            ClientId=clientId,
            Username=userName,
            Password=password,
            UserAttributes=[
                {
                    'Name': 'email',
                    'Value': 'Client'+str(i)+'@octank.com'
                },
            ]
        )

        response = cognitoClient.admin_confirm_sign_up(
            UserPoolId=poolId,
            Username=userName
        )
    
        response = cognitoClient.admin_set_user_password(
            UserPoolId=poolId,
            Username=userName,
            Password=password,
            Permanent=True
        )
    except Exception as e:
        print("Exception for user {}, {}".format(userName, e))
        

def setupUsers(numberOfUsers, userNames):
    for i in range(0, int(numberOfUsers), 1):
        createUsers(i, userNames)

def lambda_handler(event, context):
    userNames = []
    setupUsers(int(event['NumberOfUsers'] or NUMBER_OF_USERS), userNames)

    return event
        