package dto

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/types"
)

// TestToFileSourceMimePrecedence 固定文件附件的 MIME 优先级:
// data: URL 里客户端显式声明的 MIME 是权威值,文件名后缀只在它缺失时兜底。
// 反过来让后缀覆盖声明值,会把
// {filename:"scan.doc", file_data:"data:application/pdf;..."} 判成 msword,
// 下游 Claude 转换器既不匹配 pdf 也不匹配 image,整个 PDF 被丢弃。
func TestToFileSourceMimePrecedence(t *testing.T) {
	cases := []struct {
		name     string
		fileName string
		fileData string
		want     string
	}{
		{
			name:     "data URL mime wins over mismatched filename",
			fileName: "scan.doc",
			fileData: "data:application/pdf;base64,JVBERi0x",
			want:     "application/pdf",
		},
		{
			name:     "filename fills in when data URL declares no mime",
			fileName: "notes.pdf",
			fileData: "JVBERi0x",
			want:     "application/pdf",
		},
		{
			name:     "data URL mime kept when filename absent",
			fileName: "",
			fileData: "data:image/png;base64,iVBORw0K",
			want:     "image/png",
		},
		{
			name:     "both absent leaves mime empty",
			fileName: "",
			fileData: "JVBERi0x",
			want:     "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := MediaContent{
				Type: ContentTypeFile,
				File: &MessageFile{
					FileName: tc.fileName,
					FileData: tc.fileData,
				},
			}

			source := m.ToFileSource()
			if source == nil {
				t.Fatal("ToFileSource returned nil")
			}
			b64, ok := source.(*types.Base64Source)
			if !ok {
				t.Fatalf("source is %T, want *types.Base64Source", source)
			}
			// 声明在 data: URL 里的 MIME 由 Base64Source 保留原样传递;
			// 这里断言的是最终生效值(兜底推导后的结果)。
			got := b64.MimeType
			if got == "" {
				got = types.DataURLMimeType(b64.Base64Data)
			}
			if got != tc.want {
				t.Errorf("effective mime = %q, want %q", got, tc.want)
			}
		})
	}
}
