import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    //MongooseModule.forRoot('mongodb://khaivx2004:3216549872004@ac-ocpnjie-shard-00-00.re5ivoa.mongodb.net:27017,ac-ocpnjie-shard-00-01.re5ivoa.mongodb.net:27017,ac-ocpnjie-shard-00-02.re5ivoa.mongodb.net:27017/?ssl=true&replicaSet=atlas-9axqer-shard-0&authSource=admin&appName=Cluster0'),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    UsersModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
