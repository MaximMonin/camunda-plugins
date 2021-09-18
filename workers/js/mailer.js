'use strict';

const nodemailer = require('nodemailer');

class Mailer {
  constructor () {
    this.transporter = null;
  }
  init () {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_SERVER,
      port: process.env.MAIL_PORT,
      secure: true,
      auth: {
        user: process.env.MAIL_ACCOUNT,
        pass: process.env.MAIL_PASSWORD,
      },
      logger: false,
      debug: false,
      pool: true,
      maxConnections: 5,
      maxMessages: 100
    },
    {
      from: {
        name: 'Mirohost Camunda',
        address: process.env.MAIL_FROM,
      }
    }
    );
    this.transporter.verify(function(error, success) {
      if (error) {
        console.log(error);
      } else {
        console.log('Connection with mail server established');
      }
    });
  }
  sendMail (message, callback) {
    if (this.transporter) {
      this.transporter.sendMail(message, callback);
    }
  }
  stop () {
    if (this.transporter) {
      this.transporter.close();
      console.log('Disconnected from mail server');
    }
  }
}

module.exports = { Mailer };
