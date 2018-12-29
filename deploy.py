import boto3
import magic
import os

bucket_name = os.environ.get('UPLOAD_BUCKET_NAME')
directory = os.environ.get('UPLOAD_DIR', 'website')
endpoint_url = os.environ.get('UPLOAD_ENDPOINT_URL',
                              'https://storage.yandexcloud.net')

def upload_directory(client, path, bucket_name):
    mime = magic.Magic(mime=True)
    for root, dirs, files in os.walk(path):
        for file in files:
            filename = os.path.join(root,file)
            content_type = mime.from_file(filename)
            client.upload_file(
                filename,
                bucket_name,
                file,
                ExtraArgs={'ContentType': content_type})

if __name__ == '__main__':
    client = boto3.client(
        's3',
        endpoint_url=endpoint_url
    )

    upload_directory(client, directory, bucket_name)
