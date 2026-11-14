"""Fire a single structured Ark request. Input/output are JSON over stdio.

The API key is read from the server environment and never printed or passed as
a command-line argument. The Node service owns validation and persistence.
"""
import json
import os
import sys


def main():
    try:
        from arkruntime import Ark
    except ImportError:
        print("DOUBAO_SDK_UNAVAILABLE", file=sys.stderr)
        return 75
    payload = json.load(sys.stdin)
    client = Ark.volc(api_key=os.environ["DOUBAO_API_KEY"])
    completion = client.chat.completions.create(
        model=payload["model"],
        messages=payload["messages"],
        response_format=payload["response_format"],
        temperature=0,
    )
    print(json.dumps({"choices": [{"message": {"content": completion.choices[0].message.content}}]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print("DOUBAO_SDK_REQUEST_FAILED:" + str(error)[:300], file=sys.stderr)
        raise SystemExit(1)
