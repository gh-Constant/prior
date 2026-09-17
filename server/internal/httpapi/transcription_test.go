package httpapi

import (
	"bytes"
	"io"
	"mime/multipart"
	"strings"
	"testing"
)

type testMultipartFile struct {
	*bytes.Reader
}

func (testMultipartFile) Close() error { return nil }

func TestTranscriptionMultipart(t *testing.T) {
	payload, err := transcriptionMultipart(testMultipartFile{bytes.NewReader([]byte("audio bytes"))}, &multipart.FileHeader{
		Filename: `nested\recording.webm`,
		Size:     int64(len("audio bytes")),
	})
	if err != nil {
		t.Fatalf("build multipart request: %v", err)
	}

	body, err := io.ReadAll(payload.body)
	if err != nil {
		t.Fatalf("read multipart request: %v", err)
	}
	reader := multipart.NewReader(bytes.NewReader(body), strings.TrimPrefix(payload.contentType, "multipart/form-data; boundary="))
	fields := map[string]string{}
	var uploadedName string
	var uploadedBody []byte
	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			t.Fatalf("read multipart part: %v", nextErr)
		}
		value, readErr := io.ReadAll(part)
		if readErr != nil {
			t.Fatalf("read multipart value: %v", readErr)
		}
		if part.FormName() == "file" {
			uploadedName = part.FileName()
			uploadedBody = value
		} else {
			fields[part.FormName()] = string(value)
		}
	}

	if uploadedName != "recording.webm" || string(uploadedBody) != "audio bytes" {
		t.Fatalf("unexpected uploaded file: %q / %q", uploadedName, uploadedBody)
	}
	if fields["model"] != "gpt-4o-mini-transcribe" || fields["response_format"] != "json" {
		t.Fatalf("unexpected transcription fields: %#v", fields)
	}
}
