import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export const loadSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('oksocial API')
    .setDescription(
      '开放接口 /public/v1 用 Authorization 请求头传 API 密钥（团队默认密钥，或设置 > 开发者里新建的 osk_ 密钥，可设备注和有效期、随时撤销）或 OAuth 应用的 pos_ 令牌。其余接口是 Web 端用的登录态接口。'
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'Authorization' }, 'api-key')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
};
